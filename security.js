// security.js — защитные утилиты для server.js
const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, msg) { super(msg || 'error'); this.status = status; }
}

/* ---------- заголовки безопасности ---------- */
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};
const applySecurityHeaders = res => { for (const [k, v] of Object.entries(SEC_HEADERS)) res.setHeader(k, v); };

/* ---------- decodeURIComponent бросает на «%zz» и роняет процесс — оборачиваем ---------- */
function safeDecode(s) {
  try { return decodeURIComponent(String(s)); } catch (_) { return null; }
}

/* ---------- форматы ---------- */
const RE = {
  id: /^[a-f0-9]{8,64}$/i,
  email: /^[^\s@<>"']{1,254}@[^\s@<>"']{1,254}$/,
  pgKey: /^[\w:|.@-]{1,200}$/,
};
const isId = v => typeof v === 'string' && RE.id.test(v);

/* ---------- строки: убираем управляющие символы, обрезаем по длине ---------- */
function cleanText(v, max = 300) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim().slice(0, max);
}

/* ---------- защита от prototype pollution ---------- */
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const safeKey = k => typeof k === 'string' && k.length > 0 && k.length <= 60 && !BAD_KEYS.has(k);
const dict = () => Object.create(null);   // словарь без прототипа

/* ---------- PostgREST (Supabase): фильтры собираются только отсюда ---------- */
function pgIn(values) {
  const parts = values.map(v => {
    const s = String(v);
    if (!RE.pgKey.test(s)) throw new HttpError(400, 'bad key');
    return '"' + s + '"';
  });
  return 'in.(' + parts.join(',') + ')';
}
const pgQuery = params => '?' + new URLSearchParams(params).toString();

/* ---------- ограничение частоты (брутфорс входа, спам) ---------- */
const buckets = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.t >= windowMs) b = { t: now, n: 0 };
  b.n++; buckets.set(key, b);
  if (buckets.size > 20000) for (const [k, v] of buckets) if (now - v.t >= windowMs) buckets.delete(k);
  return b.n <= limit;
}
// IP клиента. За прокси (Render, Cloudflare) берём ПОСЛЕДНИЙ адрес из X-Forwarded-For:
// его дописывает прокси, а первый можно подделать. Включается переменной TRUST_PROXY=1.
function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const xf = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (xf.length) return xf[xf.length - 1];
  }
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

/* ---------- ссылки на видео для бот-комнат: строгая проверка ---------- */
const VIDEO_HOSTS = ['vk.com', 'vkvideo.ru', 'rutube.ru', 'youtube.com', 'youtu.be'];
function safeVideoUrl(raw) {
  const s = String(raw || '').trim().slice(0, 600);
  if (!s || /[\s<>"'`\\]/.test(s)) return null;
  let u; try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch (_) { return null; }
  const h = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || !VIDEO_HOSTS.some(d => h === d || h.endsWith('.' + d))) return null;
  return u.href;
}

/* ---------- тело запроса: лимит размера, нормальные ошибки, JSON должен быть объектом ---------- */
function readBody(req, max = 4e6) {   // 4 МБ: профиль с фото и галереей занимает до ~2 МБ
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, done = false;
    req.on('data', c => {
      size += c.length;
      if (size > max && !done) { done = true; reject(new HttpError(413, 'too large')); req.destroy(); return; }
      if (!done) chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      const txt = Buffer.concat(chunks).toString('utf8');
      if (!txt) return resolve({});
      let o; try { o = JSON.parse(txt); } catch (_) { return reject(new HttpError(400, 'bad json')); }
      resolve(o && typeof o === 'object' && !Array.isArray(o) ? o : {});
    });
    req.on('error', reject);
  });
}

/* ---------- сравнение без утечки по времени ---------- */
function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ---------- единый обработчик ошибок: без стека и деталей наружу ---------- */
function sendError(res, e) {
  if (res.headersSent) return;
  const status = e instanceof HttpError ? e.status : 500;
  if (status === 500) console.error('server error:', e && e.stack || e);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, SEC_HEADERS));
  res.end(JSON.stringify({ error: status === 500 ? 'server_error' : (e.message || 'error') }));
}

module.exports = {
  HttpError, applySecurityHeaders, safeDecode, RE, isId, cleanText,
  safeKey, dict, pgIn, pgQuery, rateLimit, clientIp, safeVideoUrl,
  readBody, safeEq, sendError,
};
