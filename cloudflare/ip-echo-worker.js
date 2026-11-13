/**
 * GARUDA QUANTUM 4D — 边缘网关
 * ---------------------------------------------------------------
 * 路由：
 *   GET  /ip        → 返回访客公网 IP 与网络元数据（只读，不落库）
 *   POST /api/gate  → 判定入口：验 Origin、限流、注入共享密钥，转发 Apps Script
 *
 * 约束：
 *   1. 不接收表单以外的业务数据，不写日志、不落持久化。
 *   2. /api/gate 必须带 Origin 且在白名单内（脚本直调无 Origin，直接 403）。
 *   3. GATE_SECRET 只存在 Worker 环境变量，绝不下发前端。
 *   4. 上游失败/超时一律返回 ok:false（fail-closed）。
 *
 * 环境变量：
 *   ALLOWED_ORIGINS  逗号分隔；测试期可填 "*"
 *   GATE_URL         Apps Script Web App /exec 地址
 *   GATE_SECRET      与 Apps Script 脚本属性 GATE_SECRET 同一串
 */

const BUSY_MSG = '⚠️ Jaringan sedang sibuk. Silakan coba beberapa saat lagi.';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store, no-cache, must-revalidate',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

function allowedOrigins(env) {
  return String((env && env.ALLOWED_ORIGINS) || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 无 Origin → 返回空对象（仅用于 /ip）；有 Origin 则必须命中白名单 */
function corsHeaders(origin, env) {
  const list = allowedOrigins(env);
  if (!origin) return {};
  const any = list.indexOf('*') >= 0;
  if (!any && list.indexOf(origin) === -1) return null;
  return {
    'access-control-allow-origin': any ? '*' : origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function jsonResponse(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { ...JSON_HEADERS, ...(cors || {}) },
  });
}

/* 简易限流：按 isolate 内存计数，best-effort（不跨 colo） */
const RL = new Map();
function rateLimited(key, limit, windowMs) {
  const now = Date.now();
  const b = RL.get(key);
  if (!b || now - b.t > windowMs) {
    RL.set(key, { n: 1, t: now });
    return false;
  }
  b.n++;
  if (RL.size > 5000) RL.clear();
  return b.n > limit;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);
    const ip = request.headers.get('CF-Connecting-IP') || '';

    if (request.method === 'OPTIONS') {
      if (!cors) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors });
    }

    /* ---------- /ip ---------- */
    if (url.pathname === '/ip' || url.pathname === '/') {
      if (request.method !== 'GET') {
        return jsonResponse({ error: 'method_not_allowed' }, 405, cors);
      }
      if (!cors) {
        return jsonResponse({ error: 'origin_not_allowed' }, 403, null);
      }
      if (ip && rateLimited('ip:' + ip, 60, 60000)) {
        return jsonResponse({ error: 'too_many_requests' }, 429, cors);
      }

      const cf = request.cf || {};
      const asn = cf.asn || null;
      const trusted = !(String(asn) === '13335' || ip === '2a06:98c0:3600::103');

      return jsonResponse({
        ip: ip,
        asn: asn,
        org: cf.asOrganization || null,
        country: cf.country || null,
        colo: cf.colo || null,
        tls: cf.tlsVersion || null,
        trusted: trusted,
      }, 200, cors);
    }

    /* ---------- /api/gate ---------- */
    if (url.pathname === '/api/gate') {
      if (request.method !== 'POST') {
        return jsonResponse({ ok: false, msg: BUSY_MSG }, 405, cors);
      }
      // 必须来自白名单页面；无 Origin 的脚本直调一律拒绝
      if (!origin || !cors) {
        return jsonResponse({ ok: false, msg: BUSY_MSG }, 403, null);
      }
      if (rateLimited('g:' + ip, 30, 60000)) {
        return jsonResponse({ ok: false, msg: BUSY_MSG }, 429, cors);
      }

      const target = String(env.GATE_URL || '');
      const secret = String(env.GATE_SECRET || '');
      if (!target || !secret) {
        return jsonResponse({ ok: false, msg: BUSY_MSG }, 500, cors);
      }

      let body;
      try {
        body = await request.json();
      } catch (e) {
        return jsonResponse({ ok: false, msg: BUSY_MSG }, 400, cors);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return jsonResponse({ ok: false, msg: BUSY_MSG }, 400, cors);
      }

      body.k = secret;   // 共享密钥只在此处注入

      console.log('GATE start', 'origin=' + origin, 'secret=' + (secret ? 'set' : 'missing'), 'url=' + target.slice(0, 48));

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 9000);
      try {
        const res = await fetch(target, {
          method: 'POST',
          headers: { 'content-type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
          redirect: 'follow',
        });
        clearTimeout(timer);
        const text = await res.text();
        console.log('GATE upstream', 'status=' + res.status, 'body=' + text.slice(0, 160));
        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          data = { ok: false, msg: BUSY_MSG };
        }
        return jsonResponse(data, 200, cors);
      } catch (e) {
        clearTimeout(timer);
        console.log('GATE error', String(e && e.message ? e.message : e));
        return jsonResponse({ ok: false, msg: BUSY_MSG }, 200, cors);
      }
    }

    return jsonResponse({ error: 'not_found' }, 404, null);
  },
};
