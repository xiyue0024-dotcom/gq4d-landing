/**
 * 2_Gate.gs — Web App 入口、编排、配置读取、账号下发、日志与证据
 * ---------------------------------------------------------------
 * 入口策略：
 *   POST /exec  ← Cloudflare Worker 同源代理转发（body 内带共享密钥 k）
 *   GET  /exec  ← 探活；?page=admin 管理页；JSONP 仅在关闭密钥校验时可用（降级备份）
 * 回执：allow { ok:true, wa, mode } / deny { ok:false, msg, mode }（deny 不含 wa、不含 reason）
 */

/* ======================= 入口 ======================= */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.page === 'admin') return adminHtml_();
  // 预热：提前把配置与名单灌进缓存，减少点击时的冷启动成本
  if (p.w === '1') {
    try { readConfig_(); loadBlacklist_(); } catch (err) {}
    return json_({ status: 'ok', warm: true, version: BUILD_VERSION });
  }
  if (p.d || p.cb) return handleJsonp_(p);
  return json_({ status: 'ok', version: BUILD_VERSION, time: timeStr_() });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, msg: busyMsg_(), mode: CFG.BLOCK.MODE });
  }

  const cfg = readConfig_();

  if (CFG.GATE.REQUIRE_SECRET) {
    const secret = prop_(CFG.GATE.SECRET_PROP, '');
    if (!secret || String(body.k || '') !== secret) {
      return json_({ ok: false, msg: busyMsg_(), mode: cfg.BLOCK_MODE });
    }
  }

  if (body.a === 'submit') return json_(handleSubmit_(body, cfg));
  return json_(handleGate_(body, cfg));
}

/** JSONP 降级：由 CFG.GATE.ALLOW_JSONP 控制；POST 仍强制密钥 */
function handleJsonp_(p) {
  const cb = String(p.cb || '').replace(/[^A-Za-z0-9_$.]/g, '').slice(0, 60);
  const cfg = readConfig_();
  if (!CFG.GATE.ALLOW_JSONP) {
    return jsonp_({ ok: false, msg: busyMsg_(), mode: cfg.BLOCK_MODE }, cb);
  }
  try {
    const d = JSON.parse(String(p.d || '{}'));
    return jsonp_(handleGate_(d, cfg), cb);
  } catch (e) {
    return jsonp_({ ok: false, msg: busyMsg_(), mode: cfg.BLOCK_MODE }, cb);
  }
}

/* ======================= 编排 ======================= */

/** 跳转判定主流程 */
function handleGate_(d, cfg) {
  const rec = buildVisit_(d, 'jump');

  // 紧急开关：暂停拦截时全部放行，但仍记录（用于误杀事故止损）
  if (cfg.PAUSE) {
    const wa0 = getWaNumber_(cfg);
    writeVisitLog_(rec, {
      deny: false, score: 0, reasons: ['暂停拦截'],
      hard: [], burst: { numbers: [] }
    });
    if (!wa0) return denyResponse_(cfg);
    return { ok: true, wa: wa0, mode: cfg.BLOCK_MODE };
  }

  if (!checkConsent_(rec, cfg)) {
    writeVisitLog_(rec, { deny: true, score: 0, reasons: ['未取得授权'], hard: [], burst: { numbers: [] } });
    return denyResponse_(cfg);
  }

  if (rateLimited_(rec.dev || rec.fp || rec.ipk)) {
    writeVisitLog_(rec, { deny: true, score: 0, reasons: ['频控'], hard: [], burst: { numbers: [] } });
    return denyResponse_(cfg);
  }

  // 纯点击流量没有号码：跳过名单读取，省一次共享表访问
  const bl = rec.nomor ? loadBlacklist_() : {};
  const dl = loadDeviceList_();
  const recent = readRecentVisits_(Date.now() - 24 * 3600000, CFG.RISK.SCAN_ROWS);
  const v = scoreVisit_(rec, bl, recent, cfg, dl);

  writeVisitLog_(rec, v);

  if (v.deny) {
    writeBlockLog_(rec, v, cfg);
    if (v.burst && v.burst.hit) {
      setBatchBlock_(rec, v.burst.numbers, CFG.RISK.BURST_WINDOW_MIN * 60);
    }
    autoLocalBlack_(rec, v);
    try {
      setProp_(PROP.LAST_DECISION, JSON.stringify({
        t: timeStr_(), n: rec.nomor, score: v.score,
        hard: v.hard, reasons: v.reasons
      }));
    } catch (e) {}
    return denyResponse_(cfg);
  }

  const wa = getWaNumber_(cfg);
  if (!wa) {
    writeVisitLog_(rec, {
      deny: true, score: 0, reasons: ['未配置进线账号'],
      hard: ['未配置进线账号'], burst: { numbers: [] }
    });
    return denyResponse_(cfg);
  }

  return { ok: true, wa: wa, mode: cfg.BLOCK_MODE };
}

/** 问卷提交只留痕，不判定 */
function handleSubmit_(d, cfg) {
  const rec = buildVisit_(d, 'submit');
  writeVisitLog_(rec, { deny: false, score: 0, reasons: ['留痕'], hard: [], burst: { numbers: [] } });
  return { ok: true };
}

/** 探针 → 内部记录 */
function buildVisit_(d, aksi) {
  const sig = d.sig || {};
  const nomorRaw = d.n || '';
  const ip = String(d.ip || '');
  return {
    t: Date.now(),
    aksi: aksi || d.a || 'jump',
    nomor: normPhone_(nomorRaw),
    nomorRaw: clip_(String(nomorRaw), 32),
    dev: clip_(String(d.d || ''), 64),
    fp: clip_(String(d.f || ''), 64),
    vid: (d.fp && d.fp.vid) ? clip_(String(d.fp.vid), 64) : '',
    cid: clip_(String(d.cid || ''), 64),
    ip: clip_(ip, 64),
    ips: clip_(String(d.ips || ''), 12),
    ipk: ipKey_(ip),
    asn: d.asn ? clip_(String(d.asn), 12) : '',
    org: clip_(String(d.org || ''), 80),
    country: clip_(String(d.cc || ''), 8),
    tz: clip_(String(sig.tz || ''), 48),
    ua: clip_(String(d.ua || ''), 300),
    fs: (typeof d.fs === 'number') ? d.fs : -1,
    sig: sig,
    hp: clip_(String(d.hp || ''), 64),
    tr: (d.tr === 0 || d.tr === 1) ? d.tr : 1,
    fpdata: d.fp || null,
    nv: clip_(String(d.nv || ''), 24),
    nt: clip_(String(d.nt || ''), 32),
    ct: Number(d.ct || 0)
  };
}

/* ======================= 配置 ======================= */

function readConfig_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('cfg_v1');
  if (hit) {
    try { return JSON.parse(hit); } catch (e) {}
  }
  const cfg = {
    WA_NUMBER: prop_(PROP.WA_NUMBER, CFG.WA.DEFAULT_NUMBER),
    BLOCK_MODE: prop_(PROP.BLOCK_MODE, CFG.BLOCK.MODE),
    CONSENT_MODE: prop_(PROP.CONSENT_MODE, CFG.CONSENT.MODE),
    PAUSE: prop_(PROP.PAUSE_BLOCK, 'false') === 'true'
  };
  try {
    const sh = ensureSheet_(CFG.SHEET.KONFIG, HEADERS.KONFIG);
    const t = readTable_(sh);
    const cK = colOf_(t.map, 'Kunci');
    const cV = colOf_(t.map, 'Nilai');
    for (let i = 0; i < t.rows.length; i++) {
      const k = cell_(t.rows[i], cK);
      const val = cell_(t.rows[i], cV);
      if (k === 'WA_NUMBER' && val) cfg.WA_NUMBER = normWa_(val) || cfg.WA_NUMBER;
      if (k === 'BLOCK_MODE') cfg.BLOCK_MODE = (val === 'hard' ? 'hard' : 'soft');
      if (k === 'CONSENT_MODE' && val) cfg.CONSENT_MODE = val;
      if (k === 'PAUSE_BLOCK') cfg.PAUSE = (val === 'true');
    }
  } catch (e) {
    logError_('读取配置', e);
  }
  try { cache.put('cfg_v1', JSON.stringify(cfg), 30); } catch (e) {}
  return cfg;
}

function getWaNumber_(cfg) {
  return normWa_(cfg && cfg.WA_NUMBER) || normWa_(prop_(PROP.WA_NUMBER, ''));
}

function denyResponse_(cfg) {
  return { ok: false, msg: busyMsg_(), mode: cfg.BLOCK_MODE };
}

/* ======================= 频控 ======================= */

function rateLimited_(key) {
  if (!key) return false;
  const cache = CacheService.getScriptCache();
  const bucket = 'rl_' + key + '_' + Math.floor(Date.now() / 60000);
  const n = Number(cache.get(bucket) || 0);
  if (n >= CFG.RATE_LIMIT_PER_MIN) return true;
  cache.put(bucket, String(n + 1), 120);
  return false;
}

/* ======================= 写日志 / 证据 ======================= */

function writeVisitLog_(rec, v) {
  try {
    const sh = ensureSheet_(CFG.SHEET.VISIT, HEADERS.VISIT);
    const obj = {
      '时间': timeStr_(),
      '动作': rec.aksi,
      '号码': rec.nomor,
      '号码原文': rec.nomorRaw,
      '设备ID': rec.dev,
      '指纹': rec.fp,
      'VisitorID': rec.vid,
      '点击ID': rec.cid,
      'IP键': rec.ipk,
      'IP': rec.ip,
      'IP来源': rec.ips,
      'ASN': rec.asn,
      '归属组织': rec.org,
      '国家': rec.country,
      '命中黑名单': (v.hard || []).join(';'),
      '关联号码': (v.linked || []).map(function (x) { return x.nomor; }).join(','),
      '判定': v.deny ? '拒绝' : '放行',
      '放行': v.deny ? '否' : '是',
      '原因': (v.reasons || []).join(';'),
      '下发账号': v.deny ? '' : normWa_(prop_(PROP.WA_NUMBER, '')),
      '告知版本': rec.nv,
      '告知时间': rec.nt,
      'UA': rec.ua,
      '填写秒数': rec.fs,
      '信号': JSON.stringify(rec.sig || {}),
      '客户端时间': rec.ct
    };
    withLock_(function () { appendByHeader_(sh, obj); }, 15000);
  } catch (e) {
    logError_('写访问日志', e, { n: rec.nomor });
  }
}

function writeBlockLog_(rec, v, cfg) {
  try {
    const sh = ensureSheet_(CFG.SHEET.BLOCK, HEADERS.BLOCK);
    const obj = {
      '时间': timeStr_(),
      '号码': rec.nomor,
      '命中类型': (v.hard || []).join(';') || '评分',
      '关联号码': (v.linked || []).map(function (x) { return x.nomor; }).join(','),
      '关联时间': (v.linked && v.linked[0]) ? timeStr_(new Date(v.linked[0].t)) : '',
      '设备ID': rec.dev,
      '指纹': rec.fp,
      'IP': rec.ip,
      'IP来源': rec.ips,
      'ASN': rec.asn,
      '窗口号数': (v.burst && v.burst.numbers) ? v.burst.numbers.length : 0,
      '模式': cfg.BLOCK_MODE,
      '原因': (v.reasons || []).join(';'),
      '评分': v.score,
      '命中项': (v.reasons || []).join(';'),
      '自动化信号': JSON.stringify((v.autoSig && v.autoSig.reasons) || []),
      'UA': rec.ua,
      '告知版本': rec.nv,
      // 有硬拒项 = 规则已自动判定，无需人工复核；纯评分拦截才进待处理
      '处理状态': (v.hard && v.hard.length) ? '自动' : '待处理',
      '处理人': '',
      '处理时间': '',
      '处理说明': '',
      '影响对象': ''
    };
    withLock_(function () { appendByHeader_(sh, obj); }, 15000);
  } catch (e) {
    logError_('写拦截证据', e, { n: rec.nomor });
  }
}

/** 硬拒自动写入本地名单（不写共享表） */
function autoLocalBlack_(rec, v) {
  if (!rec.nomor) return;
  const reasons = (v.hard || []).join(';');
  if (!/黑名单|同设备|同指纹|同点击ID|批次/.test(reasons)) return;
  try {
    const sh = ensureSheet_(CFG.SHEET.LOCAL_BLACK, HEADERS.LOCAL_BLACK);
    const t = readTable_(sh);
    const cN = colOf_(t.map, 'Nomor');
    const cC = colOf_(t.map, '命中次数');
    const cL = colOf_(t.map, '最后命中');
    let found = -1;
    for (let i = 0; i < t.rows.length; i++) {
      if (normPhone_(cell_(t.rows[i], cN)) === rec.nomor) { found = i; break; }
    }
    if (found >= 0) {
      const rowIdx = found + 2;
      const cnt = Number(cell_(t.rows[found], cC) || 0) + 1;
      sh.getRange(rowIdx, cC + 1).setValue(cnt);
      sh.getRange(rowIdx, cL + 1).setValue(timeStr_());
    } else {
      appendByHeader_(sh, {
        'Nomor': rec.nomor,
        'Status': 'Studio',
        'Catatan': '自动：' + clip_(reasons, 60),
        'Tanggal': timeStr_(),
        'Kunci': rec.nomor,
        '来源': 'auto',
        '命中次数': 1,
        '最后命中': timeStr_()
      });
    }
    invalidateBlacklistCache_();
  } catch (e) {
    logError_('自动入本地名单', e, { n: rec.nomor });
  }
}

/* ======================= 管理页 ======================= */

function adminHtml_() {
  return HtmlService.createHtmlOutputFromFile('管理端')
    .setTitle('落地页拦截 · 管理端')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ======================= 初始化 / 维护（手动入口） ======================= */

function setupAll() {
  const msg = setupSheets();
  const opt = optimizeSheets();
  const trig = setupArchiveTrigger();
  return logAndReturn_(msg + '\n' + opt + '\n归档触发器：' + trig);
}

function setupArchiveTrigger() {
  const fn = 'archiveOldLogs';
  const list = ScriptApp.getProjectTriggers();
  for (let i = 0; i < list.length; i++) {
    if (list[i].getHandlerFunction() === fn) return logAndReturn_('已存在');
  }
  ScriptApp.newTrigger(fn).timeBased().everyDays(1).atHour(4).create();
  return logAndReturn_('已安装（每日 04:00）');
}

function archiveOldLogs() {
  const cutoff = Date.now() - CFG.LOG.KEEP_DAYS * 86400000;
  const sh = ensureSheet_(CFG.SHEET.VISIT, HEADERS.VISIT);
  const arc = ensureSheet_(CFG.SHEET.ARCHIVE, HEADERS.VISIT);
  const last = sh.getLastRow();
  if (last < 2) return logAndReturn_('无数据');
  const n = last - 1;
  const vals = sh.getRange(2, 1, n, HEADERS.VISIT.length).getValues();
  const keep = [];
  const move = [];
  for (let i = 0; i < vals.length; i++) {
    const raw = vals[i][0];
    let ms = null;
    if (raw instanceof Date) ms = raw.getTime();
    else ms = parseTime_(String(raw));
    if (ms !== null && ms < cutoff) move.push(vals[i]);
    else keep.push(vals[i]);
  }
  if (!move.length) return logAndReturn_('无需归档');
  withLock_(function () {
    arc.getRange(arc.getLastRow() + 1, 1, move.length, HEADERS.VISIT.length).setValues(move);
    sh.getRange(2, 1, n, HEADERS.VISIT.length).clearContent();
    if (keep.length) sh.getRange(2, 1, keep.length, HEADERS.VISIT.length).setValues(keep);
  }, 30000);
  return logAndReturn_('已归档 ' + move.length + ' 行，保留 ' + keep.length + ' 行');
}

function showLastDecision() {
  return logAndReturn_(prop_(PROP.LAST_DECISION, '（暂无记录）'));
}

/** 手动入口：走一遍完整判定并写表（不发 HTTP、不依赖 Worker） */
function testHandleGate() {
  const cfg = readConfig_();
  const d = {
    a: 'jump',
    n: '08123456789',
    d: 'd_test_' + Date.now(),
    f: 'f_test',
    ip: '203.0.113.9',
    ips: 'edge',
    asn: '7713',
    org: 'PT Telkom Indonesia',
    cc: 'ID',
    fs: 20,
    nv: 'v1-2026-11-13',
    nt: new Date().toISOString(),
    ct: Date.now(),
    hp: '',
    tr: 1,
    fp: null,
    sig: {
      tz: 'Asia/Jakarta', lang: 'id-ID', lang0: 'id-ID',
      sw: 390, sh: 844, ow: 390, oh: 844,
      plugins: 3, wd: 0, hl: 0, gl: 0, ptr: 1
    }
  };
  return logAndReturn_(JSON.stringify(handleGate_(d, cfg), null, 2));
}

/** 手动入口：用名单里第一个黑名单号走一遍，生成一条拦截证据（用于测试管理页） */
function testBlockOnce() {
  const cfg = readConfig_();
  const bl = loadBlacklist_();
  const keys = Object.keys(bl).filter(function (k) {
    return CFG.RISK.BLACK_TYPES.indexOf(bl[k].type) >= 0;
  });
  if (!keys.length) return logAndReturn_('名单为空，无法测试');
  const n = keys[0];
  const d = {
    a: 'jump',
    n: n,
    d: 'd_blk_' + Date.now(),
    f: 'f_blk',
    ip: '203.0.113.9',
    ips: 'edge',
    asn: '7713',
    org: 'PT Telkom Indonesia',
    cc: 'ID',
    fs: 20,
    nv: 'v1-2026-11-13',
    nt: new Date().toISOString(),
    ct: Date.now(),
    hp: '',
    tr: 1,
    fp: null,
    sig: {
      tz: 'Asia/Jakarta', lang: 'id-ID', lang0: 'id-ID',
      sw: 390, sh: 844, ow: 390, oh: 844,
      plugins: 3, wd: 0, hl: 0, gl: 0, ptr: 1
    }
  };
  const r = handleGate_(d, cfg);
  return logAndReturn_('用名单号码 ' + n + ' 测试\n' + JSON.stringify(r, null, 2));
}
