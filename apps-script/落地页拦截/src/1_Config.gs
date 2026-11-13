/**
 * GARUDA QUANTUM 4D — 落地页进线拦截系统
 * 1_Config.gs — 配置、表头常量、通用工具
 * ---------------------------------------------------------------
 * 语言约定：内部注释/表头/日志 = 简体中文；面向访客文案 = 印尼语 baku。
 * 函数约定：`_` 结尾为私有函数，不进「运行」下拉框；手动入口不加尾下划线。
 */

const BUILD_VERSION = 'v1.9.5';

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
    SCAN_ROWS: 200,
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
    DEVICE: '设备名单',
    PROFILE: '号码档案',
    LEAD: '待联系',
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
    'IP来源', 'ASN', '窗口号数', '模式', '原因', '评分', '命中项', '自动化信号', 'UA', '告知版本',
    '处理状态', '处理人', '处理时间', '处理说明', '影响对象'
  ],
  ERR: ['时间', '位置', '错误', '原始数据'],
  AKUN: ['账号', '标识', '启用', '日配额', '今日进线', '状态', '备注', '更新于'],
  LOCAL_BLACK: ['Nomor', 'Status', 'Catatan', 'Tanggal', 'Kunci', '来源', '命中次数', '最后命中'],
  CHANGE: ['时间', '操作人', '项目', '旧值', '新值', '备注'],
  DEVICE: ['Kunci', '类型', '状态', '备注', '更新时间'],
  PROFILE: ['号码', '总访问', '放行', '拒绝', '首次出现', '最后出现', '设备数', 'IP数', '状态', '更新时间'],
  LEAD: ['时间', '号码', '姓名', '评分', '原因', '设备ID', '指纹', 'IP', '状态', '处理人', '处理时间', '备注'],
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
/** 同一次执行内的表头缓存，避免 appendByHeader_ 每次回读第一行 */
var _HEADER_CACHE = {};
/** 本次执行是否已持有脚本锁（可重入，避免同一请求反复抢锁） */
var _LOCK_HELD = false;

/**
 * 表结构版本号：改动 HEADERS 后 +1，会让所有表在 6 小时内重新校验一次表头。
 * 不做成每次请求校验——那是之前提交卡死的主因之一。
 */
const SCHEMA_VER = 'v7';

/** 读脚本属性，带默认值（同一执行内缓存，减少 Properties 调用） */
function prop_(key, dflt) {
  if (Object.prototype.hasOwnProperty.call(_PROP_CACHE, key)) {
    const c = _PROP_CACHE[key];
    return (c === null || c === undefined || c === '') ? (dflt === undefined ? '' : dflt) : c;
  }
  try {
    const v = PropertiesService.getScriptProperties().getProperty(key);
    _PROP_CACHE[key] = v;
    return (v === null || v === undefined || v === '') ? (dflt === undefined ? '' : dflt) : v;
  } catch (e) {
    return dflt === undefined ? '' : dflt;
  }
}

/** 写脚本属性 */
function setProp_(key, value) {
  _PROP_CACHE[key] = String(value == null ? '' : value);
  PropertiesService.getScriptProperties().setProperty(key, String(value == null ? '' : value));
}

/** 自有 Spreadsheet：优先 SHEET_ID；Web App 里 getActive 可能为 null */
var _SS = null;
var _SS_BLACK = null;
var _PROP_CACHE = {};
var _SHEETS_BY_NAME = null;

/**
 * 一次 getSheets() 建好「表名 → Sheet」索引。
 * 原来每张表各打一次 getSheetByName（每次 100–500ms），5 张表就是 5 次。
 * Sheet.getName() 是本地访问器，不再产生 API 调用。
 */
function sheetsByName_() {
  if (_SHEETS_BY_NAME) return _SHEETS_BY_NAME;
  const list = ss_().getSheets();
  const m = {};
  for (let i = 0; i < list.length; i++) m[list[i].getName()] = list[i];
  _SHEETS_BY_NAME = m;
  return m;
}

function ss_() {
  if (_SS) return _SS;
  const id = prop_(PROP.SHEET_ID, '');
  if (id) { _SS = SpreadsheetApp.openById(id); return _SS; }
  const active = SpreadsheetApp.getActive();
  if (active) { _SS = active; return _SS; }
  throw new Error('未配置脚本属性 SHEET_ID，且当前上下文无绑定的表格');
}

/** 共享黑名单 Spreadsheet：只读，绝不写 */
function blackSs_() {
  if (_SS_BLACK) return _SS_BLACK;
  const id = prop_(PROP.BLACKLIST_SHEET_ID, '');
  if (!id) throw new Error('未配置脚本属性 BLACKLIST_SHEET_ID（签到系统所用表格 ID）');
  _SS_BLACK = SpreadsheetApp.openById(id);
  return _SS_BLACK;
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

/**
 * 确保表存在且表头正确；号码列设为文本格式
 * ---------------------------------------------------------------
 * 性能要点（2026-11-13 修订）：
 *   1. 表头校验结果按「表名 + SCHEMA_VER」缓存 6 小时，不再每个请求回读第一行；
 *   2. 号码列文本格式只在建表/换表头时按窗口设置，并缓存已覆盖行数，
 *      不再每次请求对 getMaxRows()-1 行 × 4 列重复 setNumberFormat。
 *   3. 热路径读表用 hotSheet_()，完全跳过表头校验。
 */
function ensureSheet_(name, headers) {
  if (_SHEET_CACHE[name]) return _SHEET_CACHE[name];
  const m = sheetsByName_();
  let sh = m[name];
  let created = false;
  if (!sh) {
    sh = ss_().insertSheet(name);
    m[name] = sh;
    created = true;
  }

  const meta = meta_();
  const flag = 'sch:' + name + ':' + SCHEMA_VER;
  const verified = !created && meta[flag] === 1;

  // 只有建表 / 表头变更 / 版本升级时才校验表头与批量设格式；
  // 已验证过的表热路径零额外 API 调用。
  if (!verified) {
    const lastCol = Math.max(sh.getLastColumn(), headers.length);
    const cur = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
    let needHeader = created;
    for (let i = 0; i < headers.length; i++) {
      if (String(cur[i] || '').trim() !== headers[i]) { needHeader = true; break; }
    }
    if (needHeader) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#F1F5F9');
      sh.setFrozenRows(1);
      _HEADER_CACHE[name] = headers.slice();
    }
    ensurePhoneFormat_(sh, name, headers, true);
    meta[flag] = 1;
    metaSave_();
  }

  _SHEET_CACHE[name] = sh;
  return sh;
}

/** 号码列文本格式：按 300 行窗口增量设置，6 小时内不重复写 */
function ensurePhoneFormat_(sh, name, headers, force) {
  const cols = [];
  ['号码', '号码原文', 'Nomor', 'Kunci'].forEach(function (h) {
    const idx = headers.indexOf(h);
    if (idx >= 0) cols.push(idx + 1);
  });
  if (!cols.length) return;

  const meta = meta_();
  const key = 'fmt:' + name;
  const done = Number(meta[key] || 0);
  const last = sh.getLastRow();
  if (!force && done >= last + 300) return;

  const rows = Math.min(last + 300, sh.getMaxRows());
  if (rows < 2) return;
  cols.forEach(function (c) { sh.getRange(2, c, rows - 1, 1).setNumberFormat('@'); });
  meta[key] = rows;
  metaSave_();
}

/**
 * 表结构元信息（表头是否已校验、号码列已格式化到第几行）
 * 一次性读入内存，避免每张表各打一次 CacheService。
 */
var _META = null;

function meta_() {
  if (_META) return _META;
  try {
    _META = JSON.parse(CacheService.getScriptCache().get('meta_v1') || '{}') || {};
  } catch (e) {
    _META = {};
  }
  return _META;
}

function metaSave_() {
  try { CacheService.getScriptCache().put('meta_v1', JSON.stringify(_META), 21600); } catch (e) {}
}

/** 热路径读表：不校验表头，只取表对象（表一定已由 setupAll 建好） */
function hotSheet_(name, headers) {
  if (_SHEET_CACHE[name]) return _SHEET_CACHE[name];
  const m = sheetsByName_();
  let sh = m[name];
  if (!sh) sh = ensureSheet_(name, headers);
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

/**
 * 按表头顺序追加一行
 * - 表头只在本次执行内回读一次（原实现每次 append 都多 1 次 API 调用）
 * - 目标行若超出已格式化窗口，只对该行的号码列补一次文本格式
 */
function appendByHeader_(sh, obj) {
  const name = sh.getName();
  let map = _HEADER_CACHE[name];
  if (!map) {
    map = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
    _HEADER_CACHE[name] = map;
  }

  const row = map.map(function (h) {
    const v = obj[String(h).trim()];
    return (v === null || v === undefined) ? '' : v;
  });

  const target = sh.getLastRow() + 1;
  const phoneCols = [];
  for (let i = 0; i < map.length; i++) {
    const t = String(map[i]).trim();
    if (t === '号码' || t === '号码原文' || t === 'Nomor' || t === 'Kunci') phoneCols.push(i + 1);
  }
  if (phoneCols.length) {
    const done = Number(meta_()['fmt:' + name] || 0);
    if (target > done) {
      for (let j = 0; j < phoneCols.length; j++) {
        sh.getRange(target, phoneCols[j]).setNumberFormat('@');
      }
      meta_()['fmt:' + name] = target;
      metaSave_();
    }
  }

  sh.getRange(target, 1, 1, row.length).setValues([row]);
  return row;
}

/**
 * 脚本锁包裹写操作
 * 拿不到锁也继续执行：appendRow / setValues 不会写坏已有行，
 * 顶多偶发重复行——比让访客在遮罩里干等 15 秒要好。
 */
function withLock_(fn, ms) {
  if (_LOCK_HELD) return fn();
  const lock = LockService.getScriptLock();
  const ok = lock.tryLock(ms || 3000);
  if (!ok) return fn();
  _LOCK_HELD = true;
  try {
    return fn();
  } finally {
    _LOCK_HELD = false;
    try { lock.releaseLock(); } catch (e) {}
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
  ensureSheet_(CFG.SHEET.DEVICE, HEADERS.DEVICE);
  ensureSheet_(CFG.SHEET.PROFILE, HEADERS.PROFILE);
  ensureSheet_(CFG.SHEET.LEAD, HEADERS.LEAD);

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
    CFG.SHEET.CHANGE, CFG.SHEET.DEVICE, CFG.SHEET.PROFILE, CFG.SHEET.LEAD].join(' / '));
}

/* ======================= 表格优化（手动入口） ======================= */

/** 冻结首行、筛选、列宽、表头保护 */
function styleSheet_(sh, headers, widths) {
  sh.setFrozenRows(1);
  try {
    if (!sh.getFilter() && sh.getLastRow() >= 1) {
      sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), headers.length).createFilter();
    }
  } catch (e) {}
  Object.keys(widths || {}).forEach(function (h) {
    const i = headers.indexOf(h);
    if (i >= 0) sh.setColumnWidth(i + 1, widths[h]);
  });
  try {
    const p = sh.getRange(1, 1, 1, headers.length).protect();
    p.setDescription('表头（请勿修改）');
    p.setWarningOnly(true);
  } catch (e) {}
}

/** 下拉校验，保持状态值一致 */
function setListValidation_(sh, headers, header, values) {
  const i = headers.indexOf(header);
  if (i < 0) return;
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(values, true)
    .setAllowInvalid(false)
    .build();
  sh.getRange(2, i + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(rule);
}

/** 条件格式 */
function setRules_(sh, rules) {
  const list = rules.map(function (r) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(r.text)
      .setBackground(r.bg)
      .setFontColor(r.font || '#1F2937')
      .setRanges([r.range])
      .build();
  });
  sh.setConditionalFormatRules(list);
}

/** 命名区域，方便公式引用 */
function ensureNamedRange_(ss, name, range) {
  ss.getNamedRanges().forEach(function (r) {
    if (r.getName() === name) r.remove();
  });
  ss.setNamedRange(name, range);
}

/** 手动入口：一次性优化所有自有表 */
function optimizeSheets() {
  const ss = ss_();

  const visit = ensureSheet_(CFG.SHEET.VISIT, HEADERS.VISIT);
  styleSheet_(visit, HEADERS.VISIT, { '时间': 150, '号码': 120, '设备ID': 150, '指纹': 130, 'IP键': 130, '判定': 60 });
  const vJ = HEADERS.VISIT.indexOf('判定') + 1;
  setRules_(visit, [
    { range: visit.getRange(2, vJ, Math.max(visit.getMaxRows() - 1, 1), 1), text: '拒绝', bg: '#FBF0F0', font: '#8C2B2B' },
    { range: visit.getRange(2, vJ, Math.max(visit.getMaxRows() - 1, 1), 1), text: '放行', bg: '#EAF4F0', font: '#14624C' }
  ]);

  const block = ensureSheet_(CFG.SHEET.BLOCK, HEADERS.BLOCK);
  styleSheet_(block, HEADERS.BLOCK, { '时间': 150, '号码': 120, '评分': 55, '处理状态': 80 });
  const bS = HEADERS.BLOCK.indexOf('处理状态') + 1;
  setRules_(block, [
    { range: block.getRange(2, bS, Math.max(block.getMaxRows() - 1, 1), 1), text: '待处理', bg: '#FBF3E2', font: '#7A5312' },
    { range: block.getRange(2, bS, Math.max(block.getMaxRows() - 1, 1), 1), text: '已误判', bg: '#EAF4F0', font: '#14624C' },
    { range: block.getRange(2, bS, Math.max(block.getMaxRows() - 1, 1), 1), text: '已确认', bg: '#FBF0F0', font: '#8C2B2B' },
    { range: block.getRange(2, bS, Math.max(block.getMaxRows() - 1, 1), 1), text: '自动', bg: '#E7EEF6', font: '#0B2C4D' }
  ]);

  const local = ensureSheet_(CFG.SHEET.LOCAL_BLACK, HEADERS.LOCAL_BLACK);
  styleSheet_(local, HEADERS.LOCAL_BLACK, { 'Nomor': 130, 'Status': 80, 'Catatan': 200 });
  setListValidation_(local, HEADERS.LOCAL_BLACK, 'Status',
    CFG.BLACK_STATUS.concat(CFG.WATCH_STATUS, CFG.SAFE_STATUS));
  const lS = HEADERS.LOCAL_BLACK.indexOf('Status') + 1;
  setRules_(local, [
    { range: local.getRange(2, lS, Math.max(local.getMaxRows() - 1, 1), 1), text: 'Aman', bg: '#EAF4F0', font: '#14624C' },
    { range: local.getRange(2, lS, Math.max(local.getMaxRows() - 1, 1), 1), text: 'Studio', bg: '#FBF0F0', font: '#8C2B2B' }
  ]);

  const dev = ensureSheet_(CFG.SHEET.DEVICE, HEADERS.DEVICE);
  styleSheet_(dev, HEADERS.DEVICE, { 'Kunci': 200, '类型': 70, '状态': 70, '备注': 180 });
  setListValidation_(dev, HEADERS.DEVICE, '状态', ['Aman', 'Studio']);
  const dS = HEADERS.DEVICE.indexOf('状态') + 1;
  setRules_(dev, [
    { range: dev.getRange(2, dS, Math.max(dev.getMaxRows() - 1, 1), 1), text: 'Aman', bg: '#EAF4F0', font: '#14624C' },
    { range: dev.getRange(2, dS, Math.max(dev.getMaxRows() - 1, 1), 1), text: 'Studio', bg: '#FBF0F0', font: '#8C2B2B' }
  ]);

  const konfig = ensureSheet_(CFG.SHEET.KONFIG, HEADERS.KONFIG);
  styleSheet_(konfig, HEADERS.KONFIG, { 'Kunci': 160, 'Nilai': 220, 'Keterangan': 300 });

  ensureNamedRange_(ss, 'LOCAL_BLACK', local.getRange(1, 1, Math.max(local.getLastRow(), 1), HEADERS.LOCAL_BLACK.length));
  ensureNamedRange_(ss, 'DEVICE_LIST', dev.getRange(1, 1, Math.max(dev.getLastRow(), 1), HEADERS.DEVICE.length));
  ensureNamedRange_(ss, 'KONFIG', konfig.getRange(1, 1, Math.max(konfig.getLastRow(), 1), HEADERS.KONFIG.length));

  return logAndReturn_('已优化：冻结首行 / 筛选 / 列宽 / 下拉校验 / 条件格式 / 命名区域');
}

/**
 * 手动入口：按号码汇总访问记录，生成「号码档案」
 * 参照签到系统 Daftar Hitam 的「累计/关联数/最后时间」思路，便于对照与查重。
 */
function rebuildNumberProfile() {
  const sh = ensureSheet_(CFG.SHEET.VISIT, HEADERS.VISIT);
  const last = sh.getLastRow();
  const n = Math.min(last - 1, 5000);
  if (n <= 0) return logAndReturn_('暂无访问数据');

  const vals = sh.getRange(last - n + 1, 1, n, HEADERS.VISIT.length).getValues();
  const m = headerMap_(HEADERS.VISIT);
  const iT = m['时间'], iN = m['号码'], iD = m['设备ID'], iI = m['IP键'], iJ = m['判定'];

  const agg = {};
  for (let i = 0; i < vals.length; i++) {
    const nomor = normPhone_(vals[i][iN]);
    if (!nomor) continue;
    const rawT = vals[i][iT];
    const t = (rawT instanceof Date) ? rawT.getTime() : parseTime_(String(rawT));
    const a = agg[nomor] || (agg[nomor] = {
      total: 0, allow: 0, deny: 0, first: null, last: null, devs: {}, ips: {}
    });
    a.total++;
    if (String(vals[i][iJ] || '').indexOf('拒') >= 0) a.deny++; else a.allow++;
    if (t) {
      if (!a.first || t < a.first) a.first = t;
      if (!a.last || t > a.last) a.last = t;
    }
    if (vals[i][iD]) a.devs[String(vals[i][iD])] = 1;
    if (vals[i][iI]) a.ips[String(vals[i][iI])] = 1;
  }

  const rows = Object.keys(agg).map(function (k) {
    const a = agg[k];
    return [
      k, a.total, a.allow, a.deny,
      a.first ? timeStr_(new Date(a.first)) : '',
      a.last ? timeStr_(new Date(a.last)) : '',
      Object.keys(a.devs).length,
      Object.keys(a.ips).length,
      '',
      timeStr_()
    ];
  }).sort(function (x, y) { return y[1] - x[1]; });

  const p = ensureSheet_(CFG.SHEET.PROFILE, HEADERS.PROFILE);
  p.clearContents();
  p.getRange(1, 1, 1, HEADERS.PROFILE.length).setValues([HEADERS.PROFILE]);
  if (rows.length) {
    p.getRange(2, 1, rows.length, HEADERS.PROFILE.length).setValues(rows);
  }
  styleSheet_(p, HEADERS.PROFILE, { '号码': 130, '首次出现': 150, '最后出现': 150 });
  return logAndReturn_('号码档案已重建：' + rows.length + ' 个号码（最近 ' + n + ' 条访问）');
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
