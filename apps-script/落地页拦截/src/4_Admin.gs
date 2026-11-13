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
      dev: r[m['设备ID']],
      ip: r[m['IP']],
      mode: r[m['模式']]
    });
  }
  return out;
}

/** 误判：加入白名单（Aman） */
function markBlockFalsePositive(row, pwd) {
  checkAdminPwd_(pwd);
  const nomor = blockRowNumber_(row);
  upsertLocalBlack_(nomor, 'Aman', '人工：误判放行', 'manual');
  logConfigChange_('WHITELIST_ADD', '', nomor, '误判放行（证据行 ' + Number(row) + '）');
  return '已加入白名单：' + nomor;
}

/** 确认拦截：写入本地黑名单（Studio） */
function markBlockConfirm(row, pwd) {
  checkAdminPwd_(pwd);
  const nomor = blockRowNumber_(row);
  upsertLocalBlack_(nomor, 'Studio', '人工：确认拦截', 'manual');
  logConfigChange_('BLACKLIST_ADD', '', nomor, '确认拦截（证据行 ' + Number(row) + '）');
  return '已加入本地黑名单：' + nomor;
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

  return { total: n, deny: deny, allow: n - deny, top: top };
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

/** 从拦截证据表取号码 */
function blockRowNumber_(row) {
  const r = Number(row);
  if (!r || r < 2) throw new Error('行号无效');
  const sh = ensureSheet_(CFG.SHEET.BLOCK, HEADERS.BLOCK);
  const idx = HEADERS.BLOCK.indexOf('号码') + 1;
  const nomor = normPhone_(sh.getRange(r, idx).getDisplayValue());
  if (!nomor) throw new Error('该行没有有效号码');
  return nomor;
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
