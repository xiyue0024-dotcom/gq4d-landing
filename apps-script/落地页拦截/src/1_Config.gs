/**
 * GARUDA QUANTUM 4D — 落地页进线拦截系统
 * 1_Config.gs — 配置、表头常量、通用工具
 * ---------------------------------------------------------------
 * 语言约定：内部注释/表头/日志 = 简体中文；面向访客文案 = 印尼语 baku。
 * 函数约定：`_` 结尾为私有函数，不进「运行」下拉框；手动入口不加尾下划线。
 */

const BUILD_VERSION = 'v1.0.0';

/* ======================= 配置 ======================= */

const CFG = {
  TZ: 'Asia/Shanghai',
  DAY_TZ: 'Asia/Jakarta',

  BLOCK: {
    MODE: 'soft',                  // 'soft' 网络缓慢 / 'hard' 完全禁止跳转（管理端可切）
    SOFT_DELAY_MS: 1500,           // 软拦最小延迟（原 3500，压到 1.5s）
    SOFT_JITTER_MS: 700,
    JSONP_TIMEOUT_MS: 8000,
    FAIL_CLOSED: true,             // 后端异常/超时一律 deny，永不 open wa.me
    UNIFIED_HIT_MESSAGE: true,
    HIT_MESSAGE: '⚠️ Jaringan sedang sibuk. Silakan coba beberapa saat lagi.',
    SPINNER_TEXT: 'Memeriksa koneksi…',
  },

  /**
   * 告知/授权（2026-11-13 用户裁定：不新增授权勾选项）
   *   notice_only = 仅透明告知、不设开关、不拦截（默认，按反滥用的合法利益）
   *   required    = 必勾才放行（法务若改判再启用）
   *   dual        = 服务条款必勾 + 采集单独可选
   */
  CONSENT: {
    MODE: 'notice_only',
    VERSION: 'v1-2026-11-13',
    REQUIRED_ON_JUMP: false,
  },

  IP: {
    EDGE_ENDPOINT: '',             // 自有 CF Worker /ip，部署后填；空=走兜底
    FALLBACK_ENDPOINT: 'https://api64.ipify.org?format=json',
    FALLBACK_DISCLOSURE: true,
    ECHO_TIMEOUT_MS: 3000,
    ASYNC: true,
    USE_IN_DECISION: true,
    WEIGHTED_ONLY: true,
    SUBNET_AGGREGATE: true,
    FP_IP_CONFIRM: true,
    IP_SUBNET_MIN_NUMBERS: 3,
    DATACENTER_ASN: true,
    DATACENTER_ORG_KEYWORDS: [
      'amazon', 'aws', 'google', 'microsoft', 'azure', 'digitalocean', 'ovh',
      'hetzner', 'linode', 'vultr', 'alibaba', 'aliyun', 'cloudflare',
      'hosting', 'datacenter', 'data center', 'vps', 'server', 'colo',
      'contabo', 'leaseweb', 'choopa', 'm247', 'psychz', 'quadranet'
    ],
    COUNTRY_TZ_MISMATCH: true,
    BLACK_MATCH_IP: false,          // 黑名单关联不看 IP（CGNAT 会整片误伤）
    IGNORE_IPS: ['', 'n/a', 'na', '127.0.0.1', '::1', 'unknown', 'null', 'undefined',
      '2a06:98c0:3600::103'],       // 最后一个是 Cloudflare Worker 子请求占位 IP
    IGNORE_ASN: [13335],            // Cloudflare 自有 ASN：不可作为访客身份（WARP/代理会命中）
  },

  SIGNALS: {
    FILL_FAST_SEC: 3,
    AUTOMATION_WEIGHTED: true,
    BEHAVIOR_ENABLED: true,
  },

  RISK: {
    BURST_WINDOW_MIN: 10,
    BURST_MIN_NUMBERS: 3,
    BURST_MIN_REQUESTS: 5,
    SCAN_ROWS: 300,
    MATCH_BLACK_DEVICE: true,
    FP_COLLISION_GUARD: true,
    BLACK_TYPES: ['black', 'watch'],   // Studio/Rekan/Pantau 算黑名单；Aman 豁免
    IP_MULTI_24H: 2,                   // 拍板：24h 内同 IP 键 ≥2 个不同号码
    IP_MULTI_SCORE: 40,
    IP_MULTI_HARD_DENY: false,         // 不单独硬拒，防 CGNAT 整片误伤
    FP_IP_MULTI_24H: 2,                // 同指纹 + 同 IP 键 ≥2 号 → 硬拒
    DEV_MULTI_24H: 2,                  // 同 device_id ≥2 号 → 硬拒
    CID_MULTI_24H: 2,                  // 同广告点击 ID ≥2 号 → 硬拒
    NUM_DEV_24H: 3,                    // 同号码 ≥3 个设备 → 加分
    NUM_DEV_SCORE: 25,
  },

  /* 判定分层：硬拒 → 评分 → 放行（PoW 暂不启用，保留） */
  SCORE: {
    DENY: 60,
    CHALLENGE_MIN: 35,
    MAX: 100,
  },

  CHALLENGE: {
    ENABLED: false,                    // 拍板：暂不启用
    DIFFICULTY: 18,
    TIMEOUT_MS: 8000,
    UNSUPPORTED: 'allow',
  },

  GATE: {
    MODE: 'jsonp',                     // 当前：JSONP 直连（workers.dev 在部分网络不可达）
    REQUIRE_SECRET: true,              // POST 仍必须带共享密钥
    ALLOW_JSONP: true,                 // JSONP 降级通道（无 Origin 校验，仅作可用性兜底）
    SECRET_PROP: 'GATE_SECRET',
  },

  FP: {
    ENABLED: true,
    SERVER_VERIFY: false,              // v1 只用客户端 suspect_score；服务端核验后续开
    SERVER_API: 'https://ap.api.fpjs.io',
    SECRET_PROP: 'FP_SECRET_KEY',
    SS_HIGH: 50,                       // suspect_score ≥50 → +30
    SS_MID: 30,                        // ≥30 → +15
    SS_HIGH_SCORE: 30,
    SS_MID_SCORE: 15,
  },

  /* Daftar Hitam 的 Status 含义（值本身不翻译，避免破坏历史数据） */
  BLACK_STATUS: ['Studio', 'Rekan'],
  WATCH_STATUS: ['Pantau'],
  SAFE_STATUS: ['Aman'],
  DEFAULT_BLACK_STATUS: 'Studio',

  /* 印尼移动号段（归一化后为 62 开头，取 62 后前 3 位判断） */
  ID_MOBILE_PREFIX: [
    '811','812','813','814','815','816','817','818','819',
    '821','822','823','828','829',
    '831','832','833','838','839',
    '841','842','843','848','849',
    '851','852','853','855','856','857','858','859',
    '861','862','863','865','866','867','868',
    '871','872','873','878','879',
    '881','882','883','884','885','886','887','888','889',
    '895','896','897','898','899'
  ],

  RATE_LIMIT_PER_MIN: 5,

  WA: {
    DEFAULT_NUMBER: '',
    ROTATION: false,
    QUOTA_DAILY: 0,
  },

  LOG: {
    KEEP_DAYS: 90,
    ARCHIVE_AFTER_MONTHS: 3,
  },

  SHEET: {
    KONFIG: '配置',
    AKUN: '账号 WA',
    VISIT: '访问/跳转日志',
    BLOCK: '跳转拦截',
    ARCHIVE: '访问日志归档',
    ERR: '错误日志',
    BLACK: 'Daftar Hitam',
    LOCAL_BLACK: '本地黑名单',
    CHANGE: '配置变更',
  },
};

/* ======================= 表头常量（简体中文） ======================= */

const HEADERS = {
  KONFIG: ['Kunci', 'Nilai', 'Keterangan', 'Diubah', 'Oleh'],
  VISIT: [
    '时间', '动作', '号码', '号码原文', '设备ID', '指纹', 'VisitorID', '点击ID',
    'IP键', 'IP', 'IP来源', 'ASN', '归属组织', '国家', '命中黑名单', '关联号码',
    '判定', '放行', '原因', '下发账号', '告知版本', '告知时间', 'UA', '填写秒数',
    '信号', '客户端时间'
  ],
  BLOCK: [
    '时间', '号码', '命中类型', '关联号码', '关联时间', '设备ID', '指纹', 'IP',
    'IP来源', 'ASN', '窗口号数', '模式', '原因', '评分', '命中项', '自动化信号', 'UA', '告知版本'
  ],
  ERR: ['时间', '位置', '错误', '原始数据'],
  AKUN: ['账号', '标识', '启用', '日配额', '今日进线', '状态', '备注', '更新于'],
  LOCAL_BLACK: ['Nomor', 'Status', 'Catatan', 'Tanggal', 'Kunci', '来源', '命中次数', '最后命中'],
  CHANGE: ['时间', '操作人', '项目', '旧值', '新值', '备注'],
};

/* ======================= 脚本属性 ======================= */

const PROP = {
  SHEET_ID: 'SHEET_ID',                 // 自有表（配置/日志/证据）
  BLACKLIST_SHEET_ID: 'BLACKLIST_SHEET_ID', // 共享只读：签到系统 Daftar Hitam
  WA_NUMBER: 'WA_NUMBER',
  BLOCK_MODE: 'BLOCK_MODE',
  ADMIN_PWD: 'ADMIN_PWD',
  LAST_DECISION: 'LAST_DECISION',
  CONSENT_MODE: 'CONSENT_MODE',
  PAUSE_BLOCK: 'PAUSE_BLOCK',
};

/* ======================= 通用工具 ======================= */

/** 同一次执行内的表对象缓存，避免重复 getSheetByName / 表头检查 */
var _SHEET_CACHE = {};

/** 读脚本属性，带默认值 */
function prop_(key, dflt) {
  try {
    const v = PropertiesService.getScriptProperties().getProperty(key);
    return (v === null || v === undefined || v === '') ? (dflt === undefined ? '' : dflt) : v;
  } catch (e) {
    return dflt === undefined ? '' : dflt;
  }
}

/** 写脚本属性 */
function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value == null ? '' : value));
}

/** 自有 Spreadsheet：优先 SHEET_ID；Web App 里 getActive 可能为 null */
function ss_() {
  const id = prop_(PROP.SHEET_ID, '');
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActive();
  if (active) return active;
  throw new Error('未配置脚本属性 SHEET_ID，且当前上下文无绑定的表格');
}

/** 共享黑名单 Spreadsheet：只读，绝不写 */
function blackSs_() {
  const id = prop_(PROP.BLACKLIST_SHEET_ID, '');
  if (!id) throw new Error('未配置脚本属性 BLACKLIST_SHEET_ID（签到系统所用表格 ID）');
  return SpreadsheetApp.openById(id);
}

/** 号码归一化：统一成 62 开头纯数字；无效返回空串（用于访客号码，印尼市场） */
function normPhone_(v) {
  let s = String(v == null ? '' : v).replace(/[^0-9]/g, '');
  if (!s) return '';
  if (s.indexOf('00') === 0) s = s.slice(2);
  if (s.charAt(0) === '0') s = '62' + s.slice(1);
  else if (s.charAt(0) === '8') s = '62' + s;
  if (s.length < 9 || s.length > 16) return '';
  return s;
}

/**
 * 进线账号归一化（支持任意国家码）
 *   规则：去掉非数字；00 开头去掉；0 开头按印尼本地号补 62；
 *   其余一律视为已含国家码，不再猜测，避免把 852（香港）误补成 62852。
 */
function normWa_(v) {
  let s = String(v == null ? '' : v).replace(/[^0-9]/g, '');
  if (!s) return '';
  if (s.indexOf('00') === 0) s = s.slice(2);
  if (s.charAt(0) === '0') s = '62' + s.slice(1);
  if (s.length < 8 || s.length > 15) return '';
  return s;
}

/** IPv6 展开成 8 段 */
function expandV6_(s) {
  const parts = String(s).toLowerCase().split('::');
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = (parts.length > 1 && parts[1]) ? parts[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  const mid = [];
  for (let i = 0; i < missing; i++) mid.push('0');
  return head.concat(mid).concat(tail).map(function (x) { return x || '0'; });
}

/** IP 比对键：IPv4 /24、IPv6 /64 聚合；空/占位返回空串 */
function ipKey_(ip) {
  const s = String(ip == null ? '' : ip).trim().toLowerCase();
  if (!s) return '';
  if (CFG.IP.IGNORE_IPS.indexOf(s) >= 0) return '';
  if (s.indexOf(':') >= 0) {
    const g = expandV6_(s);
    return g.slice(0, 4).join(':') + '::/64';
  }
  const p = s.split('.');
  if (p.length !== 4) return '';
  for (let i = 0; i < 4; i++) {
    const n = parseInt(p[i], 10);
    if (isNaN(n) || n < 0 || n > 255) return '';
  }
  return p.slice(0, 3).join('.') + '.0/24';
}

/** 确保表存在且表头正确；号码列设为文本格式 */
function ensureSheet_(name, headers) {
  if (_SHEET_CACHE[name]) return _SHEET_CACHE[name];
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const lastCol = Math.max(sh.getLastColumn(), headers.length);
  const cur = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  let needHeader = false;
  for (let i = 0; i < headers.length; i++) {
    if (String(cur[i] || '').trim() !== headers[i]) { needHeader = true; break; }
  }
  if (needHeader) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#F1F5F9');
    sh.setFrozenRows(1);
  }
  // 号码列强制文本，避免 +62 被转成数字/科学计数
  ['号码', '号码原文', 'Nomor', 'Kunci'].forEach(function (h) {
    const idx = headers.indexOf(h);
    if (idx >= 0) sh.getRange(2, idx + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@');
  });
  _SHEET_CACHE[name] = sh;
  return sh;
}

/** 读表：返回 { map, rows }（displayValues，保留号码文本） */
function readTable_(sh) {
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { map: [], rows: [] };
  const values = sh.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  const map = values.shift() || [];
  return { map: map, rows: values };
}

/** 表头 → 列索引 */
function headerMap_(map) {
  const m = {};
  (map || []).forEach(function (h, i) { m[String(h).trim()] = i; });
  return m;
}

/** 按列名取索引，找不到返回 -1 */
function colOf_(map, name) {
  return (map || []).indexOf(name);
}

/** 安全取值 */
function cell_(row, idx) {
  if (!row || idx < 0 || idx >= row.length) return '';
  return row[idx] === null || row[idx] === undefined ? '' : String(row[idx]);
}

/** 按表头顺序追加一行 */
function appendByHeader_(sh, obj) {
  const map = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  const row = map.map(function (h) {
    const v = obj[String(h).trim()];
    return (v === null || v === undefined) ? '' : v;
  });
  sh.appendRow(row);
  return row;
}

/** 脚本锁包裹写操作 */
function withLock_(fn, ms) {
  const lock = LockService.getScriptLock();
  const ok = lock.tryLock(ms || 20000);
  try {
    if (!ok) throw new Error('获取脚本锁超时');
    return fn();
  } finally {
    if (ok) { try { lock.releaseLock(); } catch (e) {} }
  }
}

/** 截断字符串 */
function clip_(s, n) {
  const t = String(s == null ? '' : s);
  return t.length > n ? t.slice(0, n) : t;
}

/** 时间字符串（自有表统一用这个格式，便于回扫解析） */
function timeStr_(d) {
  const dt = d || new Date();
  return Utilities.formatDate(dt, CFG.TZ, 'yyyy-MM-dd HH:mm:ss');
}

/** 解析自有表里的时间字符串 */
function parseTime_(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const iso = m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + '+08:00';
  const t = new Date(iso).getTime();
  return isNaN(t) ? null : t;
}

/** 普通 JSON 回执 */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** JSONP 回执：cb({...}); */
function jsonp_(obj, cb) {
  const body = cb ? (cb + '(' + JSON.stringify(obj) + ');') : JSON.stringify(obj);
  return ContentService.createTextOutput(body)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/** 统一「繁忙」话术（不暴露规则） */
function busyMsg_() {
  if (CFG.BLOCK.UNIFIED_HIT_MESSAGE) return CFG.BLOCK.HIT_MESSAGE;
  return CFG.BLOCK.HIT_MESSAGE;
}

/** 错误日志（自身绝不抛错） */
function logError_(where, err, raw) {
  try {
    const sh = ensureSheet_(CFG.SHEET.ERR, HEADERS.ERR);
    appendByHeader_(sh, {
      '时间': timeStr_(),
      '位置': clip_(where, 120),
      '错误': clip_((err && err.message) ? err.message : String(err), 500),
      '原始数据': clip_(raw === undefined ? '' : JSON.stringify(raw), 1500),
    });
  } catch (e) { /* 静默 */ }
}

/** 写配置变更审计（失败不阻断主流程） */
function logConfigChange_(item, oldV, newV, note) {
  try {
    const sh = ensureSheet_(CFG.SHEET.CHANGE, HEADERS.CHANGE);
    appendByHeader_(sh, {
      '时间': timeStr_(),
      '操作人': 'admin',
      '项目': clip_(item, 40),
      '旧值': clip_(oldV, 80),
      '新值': clip_(newV, 80),
      '备注': clip_(note || '', 120)
    });
  } catch (e) {
    logError_('写配置变更', e, { item: item });
  }
}

/** 手动入口统一出口：写执行日志并返回（编辑器里只有 Logger.log 可见） */
function logAndReturn_(msg) {
  const s = String(msg == null ? '' : msg);
  Logger.log(s);
  return s;
}

/* ======================= 初始化 / 自检（手动入口） ======================= */

/** 建齐自有表并写入初始配置行（可重复运行，幂等） */
function setupSheets() {
  ensureSheet_(CFG.SHEET.KONFIG, HEADERS.KONFIG);
  ensureSheet_(CFG.SHEET.VISIT, HEADERS.VISIT);
  ensureSheet_(CFG.SHEET.BLOCK, HEADERS.BLOCK);
  ensureSheet_(CFG.SHEET.ARCHIVE, HEADERS.VISIT);
  ensureSheet_(CFG.SHEET.ERR, HEADERS.ERR);
  ensureSheet_(CFG.SHEET.AKUN, HEADERS.AKUN);
  ensureSheet_(CFG.SHEET.LOCAL_BLACK, HEADERS.LOCAL_BLACK);
  ensureSheet_(CFG.SHEET.CHANGE, HEADERS.CHANGE);

  const sh = ss_().getSheetByName(CFG.SHEET.KONFIG);
  const t = readTable_(sh);
  const m = headerMap_(t.map);
  const cK = colOf_(t.map, 'Kunci');
  const exists = {};
  t.rows.forEach(function (r) { exists[cell_(r, cK)] = true; });

  const defaults = [
    ['WA_NUMBER', prop_(PROP.WA_NUMBER, CFG.WA.DEFAULT_NUMBER), '当前进线 WhatsApp 号码（国际格式不带 +）'],
    ['BLOCK_MODE', prop_(PROP.BLOCK_MODE, CFG.BLOCK.MODE), 'soft=网络缓慢软拦 / hard=完全禁止跳转'],
    ['SOFT_DELAY_MS', String(CFG.BLOCK.SOFT_DELAY_MS), '软拦最小延迟（毫秒）'],
    ['ROTATION', CFG.WA.ROTATION ? 'true' : 'false', '账号轮换开关（本轮不启用）'],
    ['CONSENT_MODE', prop_(PROP.CONSENT_MODE, CFG.CONSENT.MODE), 'notice_only=仅告知 / required=必勾 / dual=双勾选'],
  ];
  defaults.forEach(function (row) {
    if (exists[row[0]]) return;
    const obj = {};
    obj['Kunci'] = row[0];
    obj['Nilai'] = row[1];
    obj['Keterangan'] = row[2];
    obj['Diubah'] = timeStr_();
    obj['Oleh'] = 'setupSheets';
    appendByHeader_(sh, obj);
  });

  return logAndReturn_('已建表：' + [CFG.SHEET.KONFIG, CFG.SHEET.VISIT, CFG.SHEET.BLOCK,
    CFG.SHEET.ARCHIVE, CFG.SHEET.ERR, CFG.SHEET.AKUN, CFG.SHEET.LOCAL_BLACK,
    CFG.SHEET.CHANGE].join(' / '));
}

/**
 * 手动入口：验证共享黑名单是否可读（只读，不写）
 * 运行前先设置脚本属性 BLACKLIST_SHEET_ID
 */
function testBlacklist() {
  const id = prop_(PROP.BLACKLIST_SHEET_ID, '');
  if (!id) return logAndReturn_('未配置脚本属性 BLACKLIST_SHEET_ID');
  try {
    const ss = blackSs_();
    const sh = ss.getSheetByName(CFG.SHEET.BLACK);
    if (!sh) return logAndReturn_('已打开表格「' + ss.getName() + '」，但找不到工作表：' + CFG.SHEET.BLACK);
    const t = readTable_(sh);
    return logAndReturn_('OK\n表格：' + ss.getName() +
      '\n工作表：' + CFG.SHEET.BLACK +
      '\n数据行：' + t.rows.length +
      '\n表头：' + t.map.join(' | '));
  } catch (e) {
    return logAndReturn_('打开失败：' + (e && e.message ? e.message : String(e)) +
      '\n请确认：① ID 正确；② 本脚本的执行账号对该表格有「查看者」权限。');
  }
}

/** 自检：号码归一化、IP 聚合、时区、版本 */
function testConfig() {
  const cases = [
    ['08123456789', '628123456789'],
    ['+62 812-3456-789', '628123456789'],
    ['628123456789', '628123456789'],
    ['8123456789', '628123456789'],
    ['123', ''],
    ['', ''],
  ];
  const bad = [];
  cases.forEach(function (c) {
    const got = normPhone_(c[0]);
    if (got !== c[1]) bad.push(c[0] + ' → ' + got + '（期望 ' + c[1] + '）');
  });

  const ipCases = [
    ['203.0.113.45', '203.0.113.0/24'],
    ['2001:db8:1234:5678:9abc::1', '2001:db8:1234:5678::/64'],
    ['127.0.0.1', ''],
    ['', ''],
  ];
  ipCases.forEach(function (c) {
    const got = ipKey_(c[0]);
    if (got !== c[1]) bad.push('IP ' + c[0] + ' → ' + got + '（期望 ' + c[1] + '）');
  });

  const out = [
    '版本：' + BUILD_VERSION,
    '时区：' + CFG.TZ + ' / 日界：' + CFG.DAY_TZ,
    '当前时间：' + timeStr_(),
    '告知模式：' + CFG.CONSENT.MODE,
    '软硬拦：' + CFG.BLOCK.MODE,
    '自检：' + (bad.length ? ('失败 ' + bad.length + ' 项\n' + bad.join('\n')) : '全部通过'),
  ].join('\n');
  return logAndReturn_(out);
}
