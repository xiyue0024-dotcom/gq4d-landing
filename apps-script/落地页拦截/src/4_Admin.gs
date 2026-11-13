/**
 * 4_Admin.gs — 管理端读写（google.script.run 调用）
 * 函数名不加下划线，供前端直接调用；口令校验失败抛错，由前端 failure 处理。
 * 所有变更写「配置变更」审计表。
 */

/** 读取当前配置 */
function getAdminConfig(pwd) {
  checkAdminPwd_(pwd);
  const cfg = readConfig_();
  return {
    wa: cfg.WA_NUMBER,
    mode: cfg.BLOCK_MODE,
    consent: cfg.CONSENT_MODE,
    pause: !!cfg.PAUSE,
    version: BUILD_VERSION,
    time: timeStr_()
  };
}

/** 改当前进线账号（支持任意国家码） */
function setWaNumber(num, pwd) {
  checkAdminPwd_(pwd);
  const n = normWa_(num);
  if (!n) throw new Error('号码格式不正确（需含国家码，8–15 位；印尼本地 0813… 会自动转 62）');
  const old = normWa_(prop_(PROP.WA_NUMBER, ''));
  setProp_(PROP.WA_NUMBER, n);
  setConfigRow_('WA_NUMBER', n);
  if (old !== n) logConfigChange_('WA_NUMBER', old, n, '管理页');
  return '已更新进线账号：' + n;
}

/** 一次保存拦截模式 + 告知模式（原子，避免两次请求互相覆盖） */
function saveModes(mode, consent, pwd) {
  checkAdminPwd_(pwd);
  const m = (mode === 'hard') ? 'hard' : 'soft';
  const c = (consent === 'required') ? 'required' : (consent === 'dual' ? 'dual' : 'notice_only');
  const old = readConfig_();

  setProp_(PROP.BLOCK_MODE, m);
  setProp_(PROP.CONSENT_MODE, c);
  setConfigRow_('BLOCK_MODE', m);
  setConfigRow_('CONSENT_MODE', c);

  if (old.BLOCK_MODE !== m) logConfigChange_('BLOCK_MODE', old.BLOCK_MODE, m, '管理页');
  if (old.CONSENT_MODE !== c) logConfigChange_('CONSENT_MODE', old.CONSENT_MODE, c, '管理页');

  return '已保存：拦截 ' + m + ' / 告知 ' + c;
}

/** 兼容旧入口：只改拦截模式 */
function setBlockMode(mode, pwd) {
  checkAdminPwd_(pwd);
  const m = (mode === 'hard') ? 'hard' : 'soft';
  const old = readConfig_().BLOCK_MODE;
  setProp_(PROP.BLOCK_MODE, m);
  setConfigRow_('BLOCK_MODE', m);
  if (old !== m) logConfigChange_('BLOCK_MODE', old, m, '管理页');
  return '已切换为：' + (m === 'hard' ? '硬拦（完全禁止跳转）' : '软拦（网络缓慢）');
}

/** 兼容旧入口：只改告知模式 */
function setConsentMode(mode, pwd) {
  checkAdminPwd_(pwd);
  const c = (mode === 'required') ? 'required' : (mode === 'dual' ? 'dual' : 'notice_only');
  const old = readConfig_().CONSENT_MODE;
  setProp_(PROP.CONSENT_MODE, c);
  setConfigRow_('CONSENT_MODE', c);
  if (old !== c) logConfigChange_('CONSENT_MODE', old, c, '管理页');
  return '已切换告知模式：' + c;
}

/** 紧急开关：暂停/恢复拦截 */
function setPauseBlock(pause, pwd) {
  checkAdminPwd_(pwd);
  const v = pause ? 'true' : 'false';
  const old = prop_(PROP.PAUSE_BLOCK, 'false');
  setProp_(PROP.PAUSE_BLOCK, v);
  setConfigRow_('PAUSE_BLOCK', v);
  if (old !== v) logConfigChange_('PAUSE_BLOCK', old, v, '管理页');
  return v === 'true'
    ? '已暂停拦截：所有请求放行并记录，请尽快恢复'
    : '已恢复拦截';
}

/** 最近拦截记录（最新在前） */
function getRecentBlocks(pwd, limit) {
  checkAdminPwd_(pwd);
  const sh = ensureSheet_(CFG.SHEET.BLOCK, HEADERS.BLOCK);
  const last = sh.getLastRow();
  const cap = Math.max(1, Math.min(Number(limit) || 20, 100));
  const n = Math.min(last - 1, cap);
  if (n <= 0) return [];

  const start = last - n + 1;
  const vals = sh.getRange(start, 1, n, HEADERS.BLOCK.length).getDisplayValues();
  const m = headerMap_(HEADERS.BLOCK);
  const out = [];
  for (let i = vals.length - 1; i >= 0; i--) {
    const r = vals[i];
    out.push({
      row: start + i,
      time: r[m['时间']],
      nomor: r[m['号码']],
      score: r[m['评分']],
      reasons: r[m['原因']],
      hard: r[m['命中类型']],
      dev: r[m['设备ID']],
      fp: r[m['指纹']],
      ip: r[m['IP']],
      mode: r[m['模式']],
      status: String(r[m['处理状态']] || '').trim() || '待处理',
      handler: r[m['处理人']],
      handledAt: r[m['处理时间']],
      note: r[m['处理说明']],
      target: r[m['影响对象']]
    });
  }
  return out;
}

/** 误判：加入白名单（Aman）；无号码时只标记，不改判定 */
function markBlockFalsePositive(row, pwd) {
  checkAdminPwd_(pwd);
  const info = blockRowInfo_(row);
  if (info.status && info.status !== '待处理') {
    throw new Error('该记录已处理：' + info.status);
  }
  if (!info.nomor) {
    if (info.dev || info.fp) {
      if (info.dev) upsertDevice_('dev:' + info.dev, 'device', 'Aman', '人工：误判放行');
      if (info.fp) upsertDevice_('fp:' + info.fp, 'fp', 'Aman', '人工：误判放行');
      updateBlockReview_(row, '已误判', '设备/指纹加入白名单（Aman）', '设备 ' + (info.dev || info.fp));
      logConfigChange_('DEVICE_WHITELIST_ADD', '', info.dev || info.fp, '误判放行（证据行 ' + Number(row) + '）');
      return '已加入设备白名单：' + (info.dev || info.fp) + '；后续同设备不再拦截，该记录不计入有效客户';
    }
    updateBlockReview_(row, '已误判', '无号码且无设备标识，仅标记', '仅记录');
    logConfigChange_('BLOCK_REVIEW', '', '误判/仅标记', '证据行 ' + Number(row));
    return '已标记为误判（该记录无号码也无设备标识，仅留痕，不影响后续判定）';
  }
  upsertLocalBlack_(info.nomor, 'Aman', '人工：误判放行', 'manual');
  updateBlockReview_(row, '已误判', '号码加入白名单（Aman）', '号码 ' + info.nomor);
  logConfigChange_('WHITELIST_ADD', '', info.nomor, '误判放行（证据行 ' + Number(row) + '）');
  return '已加入白名单：' + info.nomor + '；后续同号码不再拦截，该记录不计入有效客户';
}

/** 确认拦截：写入本地黑名单（Studio）；无号码时只标记 */
function markBlockConfirm(row, pwd) {
  checkAdminPwd_(pwd);
  const info = blockRowInfo_(row);
  if (info.status && info.status !== '待处理') {
    throw new Error('该记录已处理：' + info.status);
  }
  if (!info.nomor) {
    if (info.dev || info.fp) {
      if (info.dev) upsertDevice_('dev:' + info.dev, 'device', 'Studio', '人工：确认拦截');
      if (info.fp) upsertDevice_('fp:' + info.fp, 'fp', 'Studio', '人工：确认拦截');
      updateBlockReview_(row, '已确认', '设备/指纹加入黑名单（Studio）', '设备 ' + (info.dev || info.fp));
      logConfigChange_('DEVICE_BLACKLIST_ADD', '', info.dev || info.fp, '确认拦截（证据行 ' + Number(row) + '）');
      return '已加入设备黑名单：' + (info.dev || info.fp) + '；后续同设备直接拒绝，该记录不计入有效客户';
    }
    updateBlockReview_(row, '已确认', '无号码且无设备标识，仅标记', '仅记录');
    logConfigChange_('BLOCK_REVIEW', '', '确认/仅标记', '证据行 ' + Number(row));
    return '已标记为确认拦截（该记录无号码也无设备标识，仅留痕）';
  }
  upsertLocalBlack_(info.nomor, 'Studio', '人工：确认拦截', 'manual');
  updateBlockReview_(row, '已确认', '号码加入本地黑名单（Studio）', '号码 ' + info.nomor);
  logConfigChange_('BLACKLIST_ADD', '', info.nomor, '确认拦截（证据行 ' + Number(row) + '）');
  return '已加入本地黑名单：' + info.nomor + '；后续同号码直接拒绝，该记录不计入有效客户';
}

/** 待联系队列：被拦的提交 */
function getLeads(pwd, limit) {
  checkAdminPwd_(pwd);
  const sh = ensureSheet_(CFG.SHEET.LEAD, HEADERS.LEAD);
  const last = sh.getLastRow();
  const n = Math.min(last - 1, Math.max(1, Math.min(Number(limit) || 30, 100)));
  if (n <= 0) return [];

  const start = last - n + 1;
  const vals = sh.getRange(start, 1, n, HEADERS.LEAD.length).getDisplayValues();
  const m = headerMap_(HEADERS.LEAD);
  const out = [];
  for (let i = vals.length - 1; i >= 0; i--) {
    const r = vals[i];
    out.push({
      row: start + i,
      time: r[m['时间']],
      nomor: r[m['号码']],
      nama: r[m['姓名']],
      score: r[m['评分']],
      reasons: r[m['原因']],
      status: String(r[m['状态']] || '').trim() || '待处理',
      handler: r[m['处理人']],
      handledAt: r[m['处理时间']],
      note: r[m['备注']]
    });
  }
  return out;
}

/** 已联系 */
function markLeadContacted(row, pwd) {
  checkAdminPwd_(pwd);
  const info = leadRowInfo_(row);
  if (info.status === '已拉黑') throw new Error('该记录已拉黑，不能标记为已联系');
  updateLeadStatus_(row, '已联系', '人工：已通过 WhatsApp 联系');
  logConfigChange_('LEAD_CONTACTED', '', info.nomor, '待联系（行 ' + Number(row) + '）');
  return '已标记为已联系：' + info.nomor;
}

/** 误拦：加入白名单，保留线索供联系 */
function markLeadFalsePositive(row, pwd) {
  checkAdminPwd_(pwd);
  const info = leadRowInfo_(row);
  if (info.status === '已拉黑') throw new Error('该记录已拉黑，不能改判为误拦');

  if (info.nomor) upsertLocalBlack_(info.nomor, 'Aman', '人工：误拦放行', 'manual');
  if (info.dev) upsertDevice_('dev:' + info.dev, 'device', 'Aman', '人工：误拦放行');
  if (info.fp) upsertDevice_('fp:' + info.fp, 'fp', 'Aman', '人工：误拦放行');

  updateLeadStatus_(row, '已误拦', '已加入白名单，可联系客户');
  logConfigChange_('LEAD_FALSE_POSITIVE', '', info.nomor, '误拦（行 ' + Number(row) + '）');
  return '已判定为误拦：' + info.nomor + ' 已加入白名单，可直接联系';
}

/** 确认黑名单：加入黑名单，不再联系 */
function markLeadBlacklist(row, pwd) {
  checkAdminPwd_(pwd);
  const info = leadRowInfo_(row);
  if (info.status === '已联系') throw new Error('该记录已联系，不能改判为黑名单');

  if (info.nomor) upsertLocalBlack_(info.nomor, 'Studio', '人工：确认黑名单', 'manual');
  if (info.dev) upsertDevice_('dev:' + info.dev, 'device', 'Studio', '人工：确认黑名单');
  if (info.fp) upsertDevice_('fp:' + info.fp, 'fp', 'Studio', '人工：确认黑名单');

  updateLeadStatus_(row, '已拉黑', '已加入黑名单，不再联系');
  logConfigChange_('LEAD_BLACKLIST', '', info.nomor, '确认黑名单（行 ' + Number(row) + '）');
  return '已加入黑名单：' + info.nomor + '，后续不再联系';
}

/* ======================= 内部 ======================= */

function leadRowInfo_(row) {
  const r = Number(row);
  if (!r || r < 2) throw new Error('行号无效');
  const sh = ensureSheet_(CFG.SHEET.LEAD, HEADERS.LEAD);
  const m = headerMap_(HEADERS.LEAD);
  const vals = sh.getRange(r, 1, 1, HEADERS.LEAD.length).getDisplayValues()[0];
  return {
    nomor: normPhone_(vals[m['号码']]),
    dev: vals[m['设备ID']] || '',
    fp: vals[m['指纹']] || '',
    status: String(vals[m['状态']] || '').trim()
  };
}

function updateLeadStatus_(row, status, note) {
  const r = Number(row);
  if (!r || r < 2) throw new Error('行号无效');
  const sh = ensureSheet_(CFG.SHEET.LEAD, HEADERS.LEAD);
  const m = headerMap_(HEADERS.LEAD);
  sh.getRange(r, m['状态'] + 1).setValue(status);
  sh.getRange(r, m['处理人'] + 1).setValue('admin');
  sh.getRange(r, m['处理时间'] + 1).setValue(timeStr_());
  sh.getRange(r, m['备注'] + 1).setValue(note);
}

/** 最近 500 条统计：放行/拒绝/原因 Top */
function getStats(pwd) {
  checkAdminPwd_(pwd);
  const sh = ensureSheet_(CFG.SHEET.VISIT, HEADERS.VISIT);
  const last = sh.getLastRow();
  const n = Math.min(last - 1, 500);
  if (n <= 0) return { total: 0, deny: 0, allow: 0, top: [] };

  const vals = sh.getRange(last - n + 1, 1, n, HEADERS.VISIT.length).getDisplayValues();
  const m = headerMap_(HEADERS.VISIT);
  const iJ = m['判定'];
  const iR = m['原因'];
  let deny = 0;
  const reasons = {};

  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][iJ] || '').indexOf('拒') >= 0) {
      deny++;
      String(vals[i][iR] || '').split(';').forEach(function (x) {
        if (x) reasons[x] = (reasons[x] || 0) + 1;
      });
    }
  }

  const top = Object.keys(reasons)
    .sort(function (a, b) { return reasons[b] - reasons[a]; })
    .slice(0, 8)
    .map(function (k) { return { k: k, n: reasons[k] }; });

  // 拦截复核状态统计（最近 500 条）
  let pending = 0, auto = 0, reviewed = 0;
  try {
    const bsh = ensureSheet_(CFG.SHEET.BLOCK, HEADERS.BLOCK);
    const blast = bsh.getLastRow();
    const bn = Math.min(blast - 1, 500);
    if (bn > 0) {
      const bm = headerMap_(HEADERS.BLOCK);
      const bvals = bsh.getRange(blast - bn + 1, bm['处理状态'] + 1, bn, 1).getDisplayValues();
      for (let i = 0; i < bvals.length; i++) {
        const s = String(bvals[i][0] || '').trim();
        if (s === '' || s === '待处理') pending++;
        else if (s === '自动') auto++;
        else reviewed++;
      }
    }
  } catch (e) {}

  return { total: n, deny: deny, allow: n - deny, top: top, pending: pending, auto: auto, reviewed: reviewed };
}

/* ======================= 内部 ======================= */

/** 口令校验 + 失败次数限制（10 分钟内最多 8 次） */
function checkAdminPwd_(pwd) {
  const s = prop_(PROP.ADMIN_PWD, '');
  if (!s) throw new Error('未设置脚本属性 ADMIN_PWD');

  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('adm_fail') || 0);
  if (n >= 8) throw new Error('口令错误次数过多，请 15 分钟后再试');

  if (String(pwd || '') !== s) {
    cache.put('adm_fail', String(n + 1), 900);
    throw new Error('口令错误（剩余 ' + Math.max(0, 7 - n) + ' 次）');
  }
  cache.remove('adm_fail');
}

/** 读取拦截证据行的关键字段 */
function blockRowInfo_(row) {
  const r = Number(row);
  if (!r || r < 2) throw new Error('行号无效');
  const sh = ensureSheet_(CFG.SHEET.BLOCK, HEADERS.BLOCK);
  const m = headerMap_(HEADERS.BLOCK);
  const vals = sh.getRange(r, 1, 1, HEADERS.BLOCK.length).getDisplayValues()[0];
  return {
    nomor: normPhone_(vals[m['号码']]),
    dev: vals[m['设备ID']] || '',
    fp: vals[m['指纹']] || '',
    status: String(vals[m['处理状态']] || '').trim()
  };
}

/** 写回处理状态、处理人、处理时间、说明与影响对象 */
function updateBlockReview_(row, status, note, target) {
  const r = Number(row);
  if (!r || r < 2) throw new Error('行号无效');
  const sh = ensureSheet_(CFG.SHEET.BLOCK, HEADERS.BLOCK);
  const m = headerMap_(HEADERS.BLOCK);
  sh.getRange(r, m['处理状态'] + 1).setValue(status);
  sh.getRange(r, m['处理人'] + 1).setValue('admin');
  sh.getRange(r, m['处理时间'] + 1).setValue(timeStr_());
  sh.getRange(r, m['处理说明'] + 1).setValue(note);
  sh.getRange(r, m['影响对象'] + 1).setValue(target);
}

/** 写/更新设备名单（Kunci = dev:<id> 或 fp:<hash>） */
function upsertDevice_(kunci, type, status, note) {
  const sh = ensureSheet_(CFG.SHEET.DEVICE, HEADERS.DEVICE);
  const t = readTable_(sh);
  const cK = colOf_(t.map, 'Kunci');
  const cS = colOf_(t.map, '状态');
  const cN = colOf_(t.map, '备注');
  const cT = colOf_(t.map, '更新时间');

  for (let i = 0; i < t.rows.length; i++) {
    if (String(cell_(t.rows[i], cK) || '').trim() === kunci) {
      const r = i + 2;
      sh.getRange(r, cS + 1).setValue(status);
      sh.getRange(r, cN + 1).setValue(note);
      sh.getRange(r, cT + 1).setValue(timeStr_());
      invalidateDeviceCache_();
      return;
    }
  }

  appendByHeader_(sh, {
    'Kunci': kunci,
    '类型': type,
    '状态': status,
    '备注': note,
    '更新时间': timeStr_()
  });
  invalidateDeviceCache_();
}

/** 写/更新本地名单 */
function upsertLocalBlack_(nomor, status, note, src) {
  const sh = ensureSheet_(CFG.SHEET.LOCAL_BLACK, HEADERS.LOCAL_BLACK);
  const t = readTable_(sh);
  const cN = colOf_(t.map, 'Nomor');
  const cS = colOf_(t.map, 'Status');
  const cC = colOf_(t.map, 'Catatan');
  const cL = colOf_(t.map, '最后命中');

  for (let i = 0; i < t.rows.length; i++) {
    if (normPhone_(cell_(t.rows[i], cN)) === nomor) {
      const r = i + 2;
      sh.getRange(r, cS + 1).setValue(status);
      sh.getRange(r, cC + 1).setValue(note);
      if (cL >= 0) sh.getRange(r, cL + 1).setValue(timeStr_());
      invalidateBlacklistCache_();
      return;
    }
  }

  appendByHeader_(sh, {
    'Nomor': nomor,
    'Status': status,
    'Catatan': note,
    'Tanggal': timeStr_(),
    'Kunci': nomor,
    '来源': src || 'manual',
    '命中次数': 0,
    '最后命中': timeStr_()
  });
  invalidateBlacklistCache_();
}

function setConfigRow_(k, v) {
  try {
    const sh = ensureSheet_(CFG.SHEET.KONFIG, HEADERS.KONFIG);
    const t = readTable_(sh);
    const cK = colOf_(t.map, 'Kunci');
    const cV = colOf_(t.map, 'Nilai');
    const cD = colOf_(t.map, 'Diubah');
    const cO = colOf_(t.map, 'Oleh');
    for (let i = 0; i < t.rows.length; i++) {
      if (cell_(t.rows[i], cK) === k) {
        const r = i + 2;
        sh.getRange(r, cV + 1).setValue(v);
        if (cD >= 0) sh.getRange(r, cD + 1).setValue(timeStr_());
        if (cO >= 0) sh.getRange(r, cO + 1).setValue('admin');
        return;
      }
    }
    appendByHeader_(sh, {
      'Kunci': k, 'Nilai': v, 'Keterangan': '',
      'Diubah': timeStr_(), 'Oleh': 'admin'
    });
  } catch (e) {
    logError_('写配置行', e, { k: k });
  } finally {
    try { CacheService.getScriptCache().remove('cfg_v1'); } catch (e) {}
  }
}
