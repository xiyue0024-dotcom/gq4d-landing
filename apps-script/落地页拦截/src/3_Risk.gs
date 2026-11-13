/**
 * 3_Risk.gs — 名单、信号、评分、短窗聚集
 * ---------------------------------------------------------------
 * 判定分层：硬拒（definitive）→ 评分（0–100）→ 放行
 * 阈值：≥60 拒；35–59 本应挑战，但 PoW 暂不启用 → 按放行
 * 所有函数以下划线结尾者为私有，不进「运行」下拉框。
 */

/* ======================= 名单 ======================= */

/** Status → 类型：空值按黑处理（宁严勿松） */
function statusType_(s) {
  const v = String(s || '').trim().toLowerCase();
  if (!v) return 'black';
  const has = function (arr) {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].toLowerCase() === v) return true;
    }
    return false;
  };
  if (has(CFG.BLACK_STATUS)) return 'black';
  if (has(CFG.WATCH_STATUS)) return 'watch';
  if (has(CFG.SAFE_STATUS)) return 'safe';
  return 'black';
}

/** 共享黑名单：只读签到系统的 Daftar Hitam */
function loadSharedBlacklist_() {
  const out = {};
  try {
    const ss = blackSs_();
    const sh = ss.getSheetByName(CFG.SHEET.BLACK);
    if (!sh) return out;
    const t = readTable_(sh);
    const cKey = colOf_(t.map, 'Kunci');
    const cNum = colOf_(t.map, 'Nomor');
    const cSt = colOf_(t.map, 'Status');
    for (let i = 0; i < t.rows.length; i++) {
      const row = t.rows[i];
      const k = normPhone_(cell_(row, cKey)) || normPhone_(cell_(row, cNum));
      if (!k) continue;
      const st = String(cell_(row, cSt)).trim();
      out[k] = { status: st || CFG.DEFAULT_BLACK_STATUS, type: statusType_(st), src: 'shared' };
    }
  } catch (e) {
    logError_('读取共享黑名单', e);
  }
  return out;
}

/** 本地黑名单：本系统自建，可写 */
function loadLocalBlacklist_() {
  const out = {};
  try {
    const sh = ensureSheet_(CFG.SHEET.LOCAL_BLACK, HEADERS.LOCAL_BLACK);
    const t = readTable_(sh);
    const cNum = colOf_(t.map, 'Nomor');
    const cSt = colOf_(t.map, 'Status');
    for (let i = 0; i < t.rows.length; i++) {
      const row = t.rows[i];
      const k = normPhone_(cell_(row, cNum));
      if (!k) continue;
      const st = String(cell_(row, cSt)).trim();
      out[k] = { status: st || CFG.DEFAULT_BLACK_STATUS, type: statusType_(st), src: 'local' };
    }
  } catch (e) {
    logError_('读取本地黑名单', e);
  }
  return out;
}

/** 合并名单：本地优先（缓存 60 秒，写名单后主动失效） */
function loadBlacklist_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('bl_v1');
  if (hit) {
    try { return JSON.parse(hit); } catch (e) {}
  }
  const shared = loadSharedBlacklist_();
  const local = loadLocalBlacklist_();
  const out = {};
  Object.keys(shared).forEach(function (k) { out[k] = shared[k]; });
  Object.keys(local).forEach(function (k) { out[k] = local[k]; });
  try { cache.put('bl_v1', JSON.stringify(out), 60); } catch (e) {}
  return out;
}

/** 名单变更后失效缓存 */
function invalidateBlacklistCache_() {
  try { CacheService.getScriptCache().remove('bl_v1'); } catch (e) {}
}

/** 号码直查黑名单 */
function directBlackHit_(rec, bl) {
  if (!rec.nomor) return null;
  const b = bl[rec.nomor];
  if (!b) return null;
  if (CFG.RISK.BLACK_TYPES.indexOf(b.type) < 0) return null;
  return b;
}

/** 印尼手机号段校验（归一化后 62 开头） */
function validIdPhone_(nomor) {
  const n = String(nomor || '');
  if (n.indexOf('62') !== 0) return false;
  if (n.length < 10 || n.length > 14) return false;
  const p = n.slice(2, 5);
  return CFG.ID_MOBILE_PREFIX.indexOf(p) >= 0;
}

/* ======================= 历史回扫 ======================= */

/** 回扫访问日志尾部，返回 sinceMs 之后的记录（只读必要列，降低读取量） */
function readRecentVisits_(sinceMs, scanRows) {
  const sh = ensureSheet_(CFG.SHEET.VISIT, HEADERS.VISIT);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const n = Math.min(last - 1, scanRows || CFG.RISK.SCAN_ROWS);
  const start = last - n + 1;

  // 1–9 列：时间/动作/号码/原文/设备/指纹/Visitor/点击ID/IP键；17 列：判定
  const a = sh.getRange(start, 1, n, 9).getValues();
  const b = sh.getRange(start, 17, n, 1).getValues();

  const out = [];
  for (let k = 0; k < a.length; k++) {
    const r = a[k];
    const t = (r[0] instanceof Date) ? r[0].getTime() : parseTime_(String(r[0]));
    if (!t || t < sinceMs) continue;
    out.push({
      t: t,
      nomor: normPhone_(r[2]),
      dev: String(r[4] || ''),
      fp: String(r[5] || ''),
      vid: String(r[6] || ''),
      cid: String(r[7] || ''),
      ipk: String(r[8] || ''),
      deny: String(b[k][0] || '').indexOf('拒') >= 0
    });
  }
  return out;
}

/** 统计某维度下不同号码数（含当前号码） */
function countNumsBy_(recent, field, key, nomor) {
  if (!key) return 0;
  const set = {};
  for (let i = 0; i < recent.length; i++) {
    const r = recent[i];
    if (r[field] === key && r.nomor) set[r.nomor] = 1;
  }
  if (nomor) set[nomor] = 1;
  return Object.keys(set).length;
}

/** 统计同一号码出现在几个设备 */
function countDevsByNomor_(recent, nomor) {
  if (!nomor) return 0;
  const set = {};
  for (let i = 0; i < recent.length; i++) {
    const r = recent[i];
    if (r.nomor === nomor && r.dev) set[r.dev] = 1;
  }
  return Object.keys(set).length;
}

/** 指纹碰撞保护：同指纹下设备数 ≥ 号码数时视为同型号批量，不当强信号 */
function fpCollisionGuard_(fp, recent) {
  if (!fp || !CFG.RISK.FP_COLLISION_GUARD) return false;
  const devs = {}, nums = {};
  for (let i = 0; i < recent.length; i++) {
    const r = recent[i];
    if (r.fp !== fp) continue;
    if (r.dev) devs[r.dev] = 1;
    if (r.nomor) nums[r.nomor] = 1;
  }
  const d = Object.keys(devs).length;
  const n = Object.keys(nums).length;
  return d >= 2 && d >= n;
}

/** 跨号关联黑名单：新号码与历史黑名单号码共用设备/指纹/IP */
function linkedBlackHit_(rec, recent, bl) {
  const hits = [];
  const guard = fpCollisionGuard_(rec.fp, recent);
  for (let i = 0; i < recent.length; i++) {
    const r = recent[i];
    if (!r.nomor || r.nomor === rec.nomor) continue;
    const b = bl[r.nomor];
    if (!b || CFG.RISK.BLACK_TYPES.indexOf(b.type) < 0) continue;
    const sameDev = rec.dev && r.dev && rec.dev === r.dev;
    const sameFp = rec.fp && r.fp && rec.fp === r.fp && !guard;
    const sameIp = CFG.IP.BLACK_MATCH_IP && rec.ipk && r.ipk && rec.ipk === r.ipk;
    if (sameDev || sameFp || sameIp) {
      hits.push({
        nomor: r.nomor,
        status: b.status,
        via: sameDev ? '同设备' : (sameFp ? '同指纹' : '同IP'),
        t: r.t
      });
    }
  }
  return hits;
}

/* ======================= 信号 ======================= */

/** IP / ASN 加权（不单独硬拒） */
function ipWeightedSignal_(rec, recent, cfg) {
  const out = { score: 0, strong: false, reasons: [], datacenter: false, tzMismatch: false };
  if (!rec.ipk) return out;

  // Cloudflare 自有 ASN 不可作为访客身份（WARP / 子请求会命中）
  if (rec.asn && CFG.IP.IGNORE_ASN.indexOf(Number(rec.asn)) >= 0) {
    out.reasons.push('CF-IP忽略');
    return out;
  }

  const n = countNumsBy_(recent, 'ipk', rec.ipk, rec.nomor);
  if (n >= CFG.RISK.IP_MULTI_24H) {
    out.score += CFG.RISK.IP_MULTI_SCORE;
    out.reasons.push('同IP多号' + n);
    out.strong = true;
  }

  const org = String(rec.org || '').toLowerCase();
  if (CFG.IP.DATACENTER_ASN && org) {
    for (let i = 0; i < CFG.IP.DATACENTER_ORG_KEYWORDS.length; i++) {
      if (org.indexOf(CFG.IP.DATACENTER_ORG_KEYWORDS[i]) >= 0) {
        out.score += 25;
        out.reasons.push('机房ASN');
        out.datacenter = true;
        break;
      }
    }
  }

  if (CFG.IP.COUNTRY_TZ_MISMATCH && rec.country && rec.tz) {
    const idTz = /^Asia\/(Jakarta|Pontianak|Makassar|Jayapura)$/;
    if (String(rec.country).toUpperCase() === 'ID' && !idTz.test(rec.tz)) {
      out.score += 30;
      out.reasons.push('国家时区不一致');
      out.tzMismatch = true;
    }
  }
  return out;
}

/** 自动化 / 行为信号 */
function automationSignal_(rec, cfg) {
  const out = { score: 0, hard: [], reasons: [] };
  const s = rec.sig || {};
  const ua = rec.ua || '';
  const inApp = /FBAN|FBAV|Instagram|Line\/|WhatsApp|Twitter|TikTok|GSA\//i.test(ua);

  if (s.wd === 1 && !inApp) out.hard.push('WebDriver');
  if (s.hl === 1) out.hard.push('HeadlessUA');
  if (s.ow === 0 || s.oh === 0) out.hard.push('零窗口');
  if (rec.hp) out.hard.push('蜜罐');
  if (rec.tr === 0) out.hard.push('合成点击');

  if (s.gl === 1) { out.score += 25; out.reasons.push('软件渲染'); }
  if (s.plugins === 0 && !inApp && !/iPhone|iPad|Android/i.test(ua)) {
    out.score += 10;
    out.reasons.push('无插件');
  }
  if (rec.fs >= 0 && rec.fs < CFG.SIGNALS.FILL_FAST_SEC) {
    out.score += 25;
    out.reasons.push('秒填');
  }
  if (s.ptr === 0) { out.score += 20; out.reasons.push('无指针轨迹'); }
  if (s.lang && s.lang0 && s.lang !== s.lang0) {
    out.score += 5;
    out.reasons.push('语言不一致');
  }
  return out;
}

/** Fingerprint 信号（v1 只用客户端 suspect_score 与 visitor_id） */
function fpSignal_(rec, cfg, recent) {
  const out = { score: 0, reasons: [], ssHigh: false };
  const fp = rec.fpdata || null;
  if (!fp) return out;

  const ss = (typeof fp.ss === 'number') ? fp.ss : null;
  if (ss !== null) {
    if (ss >= CFG.FP.SS_HIGH) {
      out.score += CFG.FP.SS_HIGH_SCORE;
      out.reasons.push('FP疑似分' + ss);
      out.ssHigh = true;
    } else if (ss >= CFG.FP.SS_MID) {
      out.score += CFG.FP.SS_MID_SCORE;
      out.reasons.push('FP疑似分' + ss);
    }
  }

  if (fp.vid) {
    const n = countNumsBy_(recent, 'vid', String(fp.vid), rec.nomor);
    if (n >= 2) {
      out.score += 40;
      out.reasons.push('同visitor多号' + n);
    }
  }
  return out;
}

/* ======================= 短窗聚集 ======================= */

/** 通用双指针滑窗：窗口内不同号码 ≥ minNums 即标记 */
function markWindows_(byKey, winMs, minNums, mark) {
  Object.keys(byKey).forEach(function (k) {
    const arr = byKey[k].slice().sort(function (a, b) { return a.t - b.t; });
    let j = 0;
    for (let i = 0; i < arr.length; i++) {
      while (arr[i].t - arr[j].t > winMs) j++;
      const set = {};
      for (let x = j; x <= i; x++) if (arr[x].n) set[arr[x].n] = 1;
      const ns = Object.keys(set);
      if (ns.length >= minNums) ns.forEach(mark);
    }
  });
}

/** 10 分钟内同设备/指纹/IP 出现 ≥3 个不同号码 → 整批 */
function burstCheck_(rec, recent, cfg) {
  const winMs = CFG.RISK.BURST_WINDOW_MIN * 60000;
  const now = Date.now();
  const byDev = {}, byFp = {}, byIp = {};
  for (let i = 0; i < recent.length; i++) {
    const r = recent[i];
    if (now - r.t > winMs) continue;
    const item = { t: r.t, n: r.nomor };
    if (r.dev) (byDev[r.dev] = byDev[r.dev] || []).push(item);
    if (r.fp) (byFp[r.fp] = byFp[r.fp] || []).push(item);
    if (r.ipk) (byIp[r.ipk] = byIp[r.ipk] || []).push(item);
  }
  const marked = {};
  const mark = function (n) { if (n) marked[n] = 1; };
  markWindows_(byDev, winMs, CFG.RISK.BURST_MIN_NUMBERS, mark);
  markWindows_(byFp, winMs, CFG.RISK.BURST_MIN_NUMBERS, mark);
  if (rec.ipk) markWindows_(byIp, winMs, CFG.RISK.BURST_MIN_NUMBERS, mark);
  const nums = Object.keys(marked);
  return { hit: nums.length >= CFG.RISK.BURST_MIN_NUMBERS, numbers: nums };
}

/** 整批封禁写入缓存 */
function setBatchBlock_(rec, nums, ttlSec) {
  const cache = CacheService.getScriptCache();
  const keys = [rec.dev, rec.fp, rec.ipk].filter(Boolean);
  const payload = JSON.stringify({ nums: nums || [], t: Date.now() });
  keys.forEach(function (k) { cache.put('bb_' + k, payload, ttlSec || 600); });
}

/** 读取整批封禁 */
function cachedBatchBlock_(rec) {
  const cache = CacheService.getScriptCache();
  const keys = [rec.dev, rec.fp, rec.ipk].filter(Boolean);
  for (let i = 0; i < keys.length; i++) {
    const v = cache.get('bb_' + keys[i]);
    if (v) {
      try { return JSON.parse(v); } catch (e) {}
    }
  }
  return null;
}

/* ======================= 汇总判定 ======================= */

/** 告知/授权前置：notice_only 不拦截 */
function checkConsent_(rec, cfg) {
  if (cfg.CONSENT_MODE !== 'required') return true;
  return !!rec.nv;
}

/** 三层判定：硬拒 + 评分 */
function scoreVisit_(rec, bl, recent, cfg) {
  const hard = [];
  const reasons = [];
  let score = 0;

  // 号段非法
  if (rec.nomor && !validIdPhone_(rec.nomor)) hard.push('号段非法');

  // 黑名单直查
  const direct = directBlackHit_(rec, bl);
  if (direct) {
    hard.push('黑名单');
    reasons.push('名单:' + direct.status);
  }

  // 跨号关联黑名单
  const linked = linkedBlackHit_(rec, recent, bl);
  if (linked.length) {
    score += 60;
    reasons.push('跨号关联' + linked.length);
  }

  // 同设备多号
  const devN = countNumsBy_(recent, 'dev', rec.dev, rec.nomor);
  if (rec.dev && devN >= CFG.RISK.DEV_MULTI_24H) hard.push('同设备多号' + devN);

  // 同指纹 + 同 IP 多号
  const fpN = countNumsBy_(recent, 'fp', rec.fp, rec.nomor);
  if (rec.fp && rec.ipk && fpN >= CFG.RISK.FP_IP_MULTI_24H) {
    hard.push('同指纹同IP多号' + fpN);
  }

  // 同点击 ID 多号
  const cidN = countNumsBy_(recent, 'cid', rec.cid, rec.nomor);
  if (rec.cid && cidN >= CFG.RISK.CID_MULTI_24H) hard.push('同点击ID多号' + cidN);

  // 同号码多设备
  const numDev = countDevsByNomor_(recent, rec.nomor);
  if (rec.nomor && numDev >= CFG.RISK.NUM_DEV_24H) {
    score += CFG.RISK.NUM_DEV_SCORE;
    reasons.push('同号多设备' + numDev);
  }

  // IP / ASN
  const ipSig = ipWeightedSignal_(rec, recent, cfg);
  score += ipSig.score;
  Array.prototype.push.apply(reasons, ipSig.reasons);

  // 自动化 / 行为
  const autoSig = automationSignal_(rec, cfg);
  score += autoSig.score;
  Array.prototype.push.apply(reasons, autoSig.reasons);
  Array.prototype.push.apply(hard, autoSig.hard);

  // Fingerprint
  const fpSig = fpSignal_(rec, cfg, recent);
  score += fpSig.score;
  Array.prototype.push.apply(reasons, fpSig.reasons);

  // 组合规则：FP 高疑似 + 机房/时区异常 → 补足到拒绝线（抓 stealth 无头）
  if (fpSig.ssHigh && (ipSig.datacenter || ipSig.tzMismatch)) {
    score += 15;
    reasons.push('FP+网络组合');
  }

  // 短窗聚集
  const burst = burstCheck_(rec, recent, cfg);
  if (burst.hit) {
    score += 50;
    reasons.push('短窗聚集' + burst.numbers.length);
  }

  // 缓存批次封禁
  const cached = cachedBatchBlock_(rec);
  if (cached) {
    hard.push('批次封禁');
    reasons.push('批次' + ((cached.nums || []).length));
  }

  score = Math.min(score, CFG.SCORE.MAX);
  return {
    deny: hard.length > 0 || score >= CFG.SCORE.DENY,
    hard: hard,
    score: score,
    reasons: reasons,
    linked: linked,
    burst: burst,
    ipSig: ipSig,
    autoSig: autoSig,
    fpSig: fpSig
  };
}

/* ======================= 自测（手动入口） ======================= */

/** 纯逻辑 dry-run，不读写表格、不发外部请求 */
function testGate() {
  const cfg = { CONSENT_MODE: 'notice_only', BLOCK_MODE: 'soft' };
  const base = {
    nomor: '628123456789', dev: 'd1', fp: 'f1', vid: '', cid: '',
    ipk: '203.0.113.0/24', asn: '7713', org: 'PT Telkom Indonesia',
    country: 'ID', tz: 'Asia/Jakarta', ua: 'Mozilla/5.0 (Linux; Android 12)',
    fs: 20, hp: '', tr: 1, fpdata: null,
    sig: { wd: 0, hl: 0, ow: 390, oh: 844, plugins: 3, gl: 0, ptr: 1, lang: 'id-ID', lang0: 'id-ID' }
  };
  const out = [];

  out.push('① 干净请求 → ' + (scoreVisit_(base, {}, [], cfg).deny ? '拒' : '放行'));

  out.push('② 黑名单号 → ' + (scoreVisit_(base,
    { '628123456789': { type: 'black', status: 'Studio' } }, [], cfg).deny ? '拒' : '放行'));

  const h = JSON.parse(JSON.stringify(base));
  h.sig.wd = 1;
  out.push('③ WebDriver → ' + (scoreVisit_(h, {}, [], cfg).deny ? '拒' : '放行'));

  const recent = [{
    t: Date.now() - 60000, nomor: '628111111111', dev: 'd1', fp: 'f1',
    vid: '', cid: '', ipk: '', deny: false
  }];
  out.push('④ 同设备第2号 → ' + (scoreVisit_(base, {}, recent, cfg).deny ? '拒' : '放行'));

  const dc = JSON.parse(JSON.stringify(base));
  dc.org = 'Amazon.com'; dc.asn = '16509';
  out.push('⑤ 机房ASN单独 → ' + (scoreVisit_(dc, {}, [], cfg).deny ? '拒' : '放行'));

  const f = JSON.parse(JSON.stringify(base));
  f.fpdata = { vid: 'v1', ss: 60 };
  out.push('⑥ FP疑似60单独（+30）→ ' + (scoreVisit_(f, {}, [], cfg).deny ? '拒' : '放行') + '（预期放行）');

  const bad = JSON.parse(JSON.stringify(base));
  bad.nomor = '628000000000';
  out.push('⑦ 号段非法 → ' + (scoreVisit_(bad, {}, [], cfg).deny ? '拒' : '放行') + '（预期拒）');

  const combo = JSON.parse(JSON.stringify(f));
  combo.org = 'Amazon.com';
  combo.asn = '16509';
  out.push('⑧ FP疑似60 + 机房 → ' + (scoreVisit_(combo, {}, [], cfg).deny ? '拒' : '放行') + '（预期拒）');

  const combo2 = JSON.parse(JSON.stringify(f));
  combo2.tz = 'Asia/Shanghai';
  out.push('⑨ FP疑似60 + 时区异常 → ' + (scoreVisit_(combo2, {}, [], cfg).deny ? '拒' : '放行') + '（预期拒）');

  return logAndReturn_(out.join('\n'));
}
