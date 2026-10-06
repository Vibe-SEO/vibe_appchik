// npm i ws && node server.js   (index.html лежит рядом, security.js — тоже)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws'), zlib = require('zlib');
const SEC = require('./security');
/* ---- Капча (Cloudflare Turnstile, бесплатно): https://dash.cloudflare.com → Turnstile → Add site ----
   TURNSTILE_SITEKEY (публичный) и TURNSTILE_SECRET (секретный) — переменные окружения или config.json: { "turnstileSiteKey": "...", "turnstileSecret": "..." }.
   Пока ключей нет — капча выключена, сайт работает как раньше. */
const PORT = process.env.PORT || 3000, DIR = process.env.DATA_DIR || __dirname, DBF = path.join(DIR, 'data.json'); // DATA_DIR — папка на постоянном диске хостинга, иначе вход слетает при каждом перезапуске
/* Настройки: переменные окружения ИЛИ файл config.json рядом с server.js:
   { "tgToken": "123456:AA...(токен из BotFather)", "tgName": "my_vibe_bot", "admins": ["you@mail.com"] } */
const cfg = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch (_) { return {}; } })();
const why = e => (e && e.message || String(e)) + (e && e.cause ? ' [' + (e.cause.code || e.cause.message) + ']' : '');   // причина сетевой ошибки
const TGT = String(process.env.TG_BOT_TOKEN || cfg.tgToken || '').trim().replace(/^bot/i, ''), TGN = String(process.env.TG_BOT_NAME || cfg.tgName || '').replace(/^@/, '');
const ADMIN = String(process.env.ADMIN_EMAILS || [].concat(cfg.admins || []).join(',')).toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
const TGAPP = String(process.env.TG_APP_NAME || cfg.tgApp || '').replace(/^[@/]+/, '').trim();   // короткое имя Mini App из BotFather (/newapp) — для ссылок t.me/бот/приложение?startapp=room_ID; пусто — используется Main Mini App (t.me/бот?startapp=...)
const FRONT = String(process.env.FRONT_URL || cfg.frontUrl || '').replace(/\/$/, '');   // адрес сайта на Netlify, например https://vibe.netlify.app (куда вернуть после входа через Telegram)
const STARS = Math.max(1, +(process.env.PREMIUM_STARS || cfg.premiumStars || 100)), TGA = String(process.env.TG_ADMIN_IDS || [].concat(cfg.adminTgIds || []).join(',')).split(',').map(x => x.trim()).filter(Boolean);   // цена в Telegram Stars; числовые Telegram-id админов (необязательно)
const TSK = String(process.env.TURNSTILE_SITEKEY || cfg.turnstileSiteKey || '').trim(), TSS = String(process.env.TURNSTILE_SECRET || cfg.turnstileSecret || '').trim(), CAPTCHA_ON = !!(TSK && TSS);
if (!CAPTCHA_ON) console.warn('⚠ Капча выключена: задайте TURNSTILE_SITEKEY и TURNSTILE_SECRET');
async function captchaOk(token, ip) {
  if (!CAPTCHA_ON) return true;
  token = String(token || ''); if (!token || token.length > 2048) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ secret: TSS, response: token, remoteip: ip || '' }), signal: AbortSignal.timeout(5000) });
    const j = await r.json(); return !!(j && j.success);
  } catch (e) { console.error('captcha:', why(e)); return false; }   // нет связи с Cloudflare — не пускаем (безопаснее)
}
const TZ = process.env.STATS_TZ || 'Europe/Moscow';
const BOTF = path.join(DIR, 'bots.json'), bots = () => { try { return JSON.parse(fs.readFileSync(BOTF, 'utf8')); } catch (_) { return {}; } };
// bots.json: { "Название": "ссылка", "__durs": { "Название": минуты } }
const botLinks = () => { const o = bots(); delete o.__durs; return o; }, botDurs = () => { const d = bots().__durs; return d && typeof d === 'object' ? d : {}; };
let db = { users: {}, tokens: {}, payments: {}, stats: { days: {} }, chats: {}, reqs: [] };
try { db = JSON.parse(fs.readFileSync(DBF, 'utf8')); db.users = db.users || {}; db.tokens = db.tokens || {}; db.payments = db.payments || {}; db.stats = db.stats || {}; db.stats.days = db.stats.days || {}; db.chats = db.chats || {}; db.reqs = db.reqs || []; }
catch (e) { if (e.code !== 'ENOENT') { try { fs.copyFileSync(DBF, DBF + '.broken-' + Date.now()); } catch (_) {} console.error('data.json не прочитан, копия сохранена:', e.message); } }
// запись атомарная (tmp + rename): параллельные writeFile раньше могли испортить data.json, и тогда все вылетали из аккаунтов
let st = null;
const flushDb = () => { clearTimeout(st); st = null; try { fs.writeFileSync(DBF + '.tmp', JSON.stringify(db)); fs.renameSync(DBF + '.tmp', DBF); } catch (e) { console.error('save:', e.message); } schedRemote(); };
const save = () => { if (!st) st = setTimeout(flushDb, 150); };

/* ---- Supabase: постоянное хранилище (переживает перезапуски и деплои Render) ----
   Таблица vibe_kv(k text primary key, v jsonb): u:<id> — пользователь, t:<токен> — вход, p:<id платежа>, s:<день> — статистика, bots — ссылки бот-комнат.
   Пишутся только изменившиеся записи. data.json остаётся запасной копией. */
const SBU = String(process.env.SUPABASE_URL || cfg.supabaseUrl || '').trim().replace(/\/$/, ''), SBK = String(process.env.SUPABASE_KEY || cfg.supabaseKey || '').trim(), REMOTE = !!(SBU && SBK);
const sbReq = async (q, opt = {}) => {
  const headers = Object.assign({ apikey: SBK, 'Content-Type': 'application/json' }, SBK.startsWith('eyJ') ? { Authorization: 'Bearer ' + SBK } : {}, opt.headers);
  const r = await fetch(SBU + '/rest/v1/vibe_kv' + q, Object.assign({}, opt, { headers }));
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r;
};
const sig = new Map(), md5 = x => crypto.createHash('md5').update(x).digest('hex');
let rfail = false, rt = null, rq = Promise.resolve();
function remoteRows() {
  const rows = [], add = (k, v) => { const h = md5(JSON.stringify(v)); if (sig.get(k) !== h) rows.push({ k, v, h }); };
  Object.entries(db.users).forEach(([id, u]) => add('u:' + id, u));
  Object.entries(db.tokens).forEach(([t, id]) => { if (!sig.has('t:' + t)) rows.push({ k: 't:' + t, v: id, h: '1' }); });
  Object.entries(db.payments).forEach(([c, p]) => add('p:' + c, p));
  Object.entries(db.stats.days).forEach(([d, x]) => add('s:' + d, x));
  Object.entries(db.chats || {}).forEach(([k, x]) => add('c:' + k, x)); add('q', { l: db.reqs || [] });
  try { add('bots', { txt: fs.readFileSync(BOTF, 'utf8') }); } catch (_) {}
  return rows;
}
const delQ = new Set();   // ключи, которые нужно стереть в Supabase (удалённые аккаунты) — иначе после перезапуска они бы «воскресли»
const rdel = k => { sig.delete(k); if (REMOTE) delQ.add(k); };
async function doPush() {
  if (!REMOTE) return;
  try {
    if (delQ.size) {
      const ks = [...delQ];
      for (let i = 0; i < ks.length; i += 40) {
        const part = ks.slice(i, i + 40);
        await sbReq(SEC.pgQuery({ k: SEC.pgIn(part) }), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        part.forEach(k => delQ.delete(k));
      }
    }
    const rows = remoteRows();
    for (let i = 0; i < rows.length; i += 25) {
      const part = rows.slice(i, i + 25), at = new Date().toISOString();
      await sbReq('?on_conflict=k', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(part.map(x => ({ k: x.k, v: x.v, updated_at: at }))) });
      part.forEach(x => sig.set(x.k, x.h));
    }
    rfail = false;
  } catch (e) { rfail = true; console.error('supabase save:', why(e)); }
}
const pushRemote = () => (rq = rq.then(doPush));
function schedRemote() { if (REMOTE && !rt) rt = setTimeout(() => { rt = null; pushRemote(); }, 1500); }
setInterval(() => rfail && pushRemote(), 20000);   // если Supabase был недоступен — повторяем
async function loadRemote() {
  for (let a = 1; ; a++) {
    try {
      const rows = [];
      for (let off = 0; ; off += 40) { const r = await (await sbReq('?select=k,v&order=k&limit=40&offset=' + off)).json(); rows.push(...r); if (r.length < 40) break; }
      if (!rows.length) { console.log('Supabase пока пуст — загружаю в него локальные данные'); return; }
      const nd = { users: {}, tokens: {}, payments: {}, stats: { days: {} }, chats: {}, reqs: [] };
      for (const { k, v } of rows) {
        if (k.startsWith('u:')) nd.users[k.slice(2)] = v; else if (k.startsWith('t:')) nd.tokens[k.slice(2)] = v;
        else if (k.startsWith('p:')) nd.payments[k.slice(2)] = v; else if (k.startsWith('s:')) nd.stats.days[k.slice(2)] = v; else if (k.startsWith('c:')) nd.chats[k.slice(2)] = v; else if (k === 'q') nd.reqs = (v && v.l) || [];
        else if (k === 'bots' && v && typeof v.txt === 'string') { try { fs.writeFileSync(BOTF + '.tmp', v.txt); fs.renameSync(BOTF + '.tmp', BOTF); } catch (_) {} }
      }
      db = nd; BD = botDurs(); remoteRows().forEach(x => sig.set(x.k, x.h));
      console.log('Supabase: загружено аккаунтов — ' + Object.keys(db.users).length); return;
    } catch (e) { console.error('supabase load (' + a + '/5):', why(e)); if (a >= 5) throw e; await new Promise(z => setTimeout(z, 3000)); }
  }
}
['SIGTERM', 'SIGINT'].forEach(sg => process.on(sg, async () => { flushDb(); await Promise.race([pushRemote(), new Promise(z => setTimeout(z, 8000))]); process.exit(0); }));
const rid = n => crypto.randomBytes(n).toString('hex');
const hash = (p, s) => crypto.scryptSync(p, s, 32).toString('hex');
const isAdmin = u => !!u && (ADMIN.includes((u.email || '').toLowerCase()) || (!!u.tgUser && ADMIN.includes('@' + u.tgUser.toLowerCase())));
// проверка подписи Telegram Login Widget (HMAC-SHA256 от токена бота)
function tgVerify(d) {
  if (!TGT || !d || !d.hash || !d.id) return false;
  const str = Object.keys(d).filter(k => k !== 'hash').sort().map(k => k + '=' + d[k]).join('\n');
  const h = crypto.createHmac('sha256', crypto.createHash('sha256').update(TGT).digest()).update(str).digest('hex'), a = Buffer.from(h), b = Buffer.from(String(d.hash));
  return a.length === b.length && crypto.timingSafeEqual(a, b) && Date.now() / 1000 - (+d.auth_date || 0) < 86400;
}
// проверка initData мини-приложения Telegram (ключ = HMAC_SHA256("WebAppData", токен бота)) → объект user или null
function tgInitVerify(raw) {
  if (!TGT || typeof raw !== 'string' || !raw || raw.length > 8192) return null;
  const p = new URLSearchParams(raw), h = p.get('hash'); if (!h) return null; p.delete('hash');
  const str = [...p.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => k + '=' + v).join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(TGT).digest(), a = Buffer.from(crypto.createHmac('sha256', key).update(str).digest('hex')), b = Buffer.from(h);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b) || Date.now() / 1000 - (+p.get('auth_date') || 0) > 86400) return null;
  try { const u = JSON.parse(p.get('user') || ''); return u && u.id ? u : null; } catch (_) { return null; }
}
// вход/привязка Telegram: общий код для popup (/api/tg) и редиректа (/api/tg-cb)
function tgUpsert(b, cur) {
  const tid = String(b.id), nm = ([b.first_name, b.last_name].filter(Boolean).join(' ') || b.username || 'Telegram').slice(0, 30);
  let user = Object.values(db.users).find(x => x.tgId === tid);
  if (cur && user && user.id !== cur.id) return { error: 'Этот Telegram уже привязан к другому аккаунту' };
  if (!user) { user = cur || { id: rid(6), name: nm, color: 'p', friends: [], created: Date.now() }; db.users[user.id] = user; }
  Object.assign(user, { tgId: tid, tgUser: String(b.username || ''), tgName: nm, tgPhoto: String(b.photo_url || '') });
  if (!user.photo && b.photo_url) user.photo = String(b.photo_url);
  return { user };
}
const pub = u => ({ tg: u.tgId ? { id: u.tgId, username: u.tgUser || '', name: u.tgName || '' } : null, admin: isAdmin(u), id: u.id, name: u.name, bio: u.bio || '', color: u.color || 'p', photo: u.photo || null, until: u.until || null, premium: !!(u.until && u.until > Date.now()), friends: u.friends || [], prefs: u.prefs || null, gallery: u.gallery || [], created: u.created || null, stats: statsPub(u) });

/* ---- статистика: время в комнатах, самый долгий сеанс, самая большая комната, часы по месяцам ----
   Хранится в user.stat = { sec, longest, biggest, mo: { 'YYYY-MM': сек } }. Считается раз в 20 с, пока человек сидит в комнате. */
function statOf(x) { return x.stat || (x.stat = { sec: 0, longest: 0, biggest: 0, mo: {} }); }
function statsPub(x, online) {
  const s = x.stat || {}, mo = s.mo || {}, now = new Date(), monthly = [], h = v => Math.round((v || 0) / 36) / 100;   // часы с точностью до 0.01
  for (let i = 5; i >= 0; i--) monthly.push(h(mo[new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7)]));
  return { hours: h(s.sec), longest: h(s.longest), biggest: s.biggest || 0, monthly, joined: x.created || null, online: online === undefined ? undefined : !!online };
}
function tickStats(w) {
  const x = db.users[w.uid]; if (!x || !w.room || !w.tk) return;
  const now = Date.now(), dt = Math.min(60000, now - w.tk); w.tk = now; if (dt <= 0) return;
  const s = statOf(x), d = dt / 1000, k = dayKey().slice(0, 7);
  s.sec += d; w.sess = (w.sess || 0) + d; if (w.sess > s.longest) s.longest = w.sess;
  s.mo[k] = (s.mo[k] || 0) + d; const ks = Object.keys(s.mo).sort(); while (ks.length > 12) delete s.mo[ks.shift()];
}

/* ---- аватарки в чате: в сообщении только ссылка (http-фото как есть, загруженное фото — через /api/avatar/<id>?v=хэш) ---- */
const avCache = new Map();
const avUrl = u => {
  const ph = u && u.photo; if (typeof ph !== 'string' || !ph) return null;
  if (/^https?:\/\//.test(ph)) return ph;
  let c = avCache.get(u.id); if (!c || c.ph !== ph) { c = { ph, url: '/api/avatar/' + u.id + '?v=' + md5(ph).slice(0, 8) }; avCache.set(u.id, c); }
  return c.url;
};
/* ---- страна участника для глобуса: заголовок CDN (Cloudflare/Render) → геобаза по IP (GEO_LOOKUP=0 выключает) ---- */
const geoCache = new Map(), GEO_ON = String(process.env.GEO_LOOKUP || cfg.geoLookup || '1') !== '0';
const cfCC = req => { const c = String(req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || '').toUpperCase(); return /^[A-Z]{2}$/.test(c) && c !== 'XX' && c !== 'T1' ? c : null; };
async function geoLookup(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().replace(/^::ffff:/, '');
  if (!GEO_ON || !ip || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd)/i.test(ip)) return null;
  if (geoCache.has(ip)) return geoCache.get(ip);
  try {
    const r = await fetch('https://ipwho.is/' + encodeURIComponent(ip) + '?fields=success,country_code', { signal: AbortSignal.timeout(3500) }), j = await r.json();
    const cc = j && j.success && /^[A-Z]{2}$/.test(j.country_code || '') ? j.country_code : null;
    if (geoCache.size > 5000) geoCache.clear(); geoCache.set(ip, cc); return cc;
  } catch (_) { return null; }
}
/* ---- комнаты: живут только пока в них кто-то есть ---- */
const rooms = new Map(), socks = new Set();

/* ---- бот-комнаты: «эфир» 24/7 ----
   Комнаты постоянные. Позиция фильма = (серверное время − старт) mod длительность, поэтому
   не хранится и не сбивается перезапуском: любой зритель в любой момент попадает в одну и ту же секунду.
   dur (сек) по умолчанию = длительность ролика-заглушки; реальную длину фильма админ задаёт в минутах. */
const EPOCH = 1735689600000;
const CATALOG = [   // title обязан совпадать с BOT_MEDIA в index.html
  { title: 'Человек-паук: Новый день', dur: 596, base: 56, ph: 0 },
  { title: 'Круэлла', dur: 734, base: 33, ph: 137 },
  { title: 'Двойной форсаж', dur: 888, base: 25, ph: 251 },
  { title: 'Мстители: Финал', dur: 596, base: 41, ph: 402 },
  { title: 'Интерстеллар', dur: 734, base: 30, ph: 77 },
  { title: 'Форсаж 10', dur: 888, base: 38, ph: 519 },
];
let BD = botDurs();
const bDur = r => (BD[r.title] > 0 ? BD[r.title] * 60 : r.bot.dur), bStart = r => EPOCH + r.bot.ph * 1000;
const bPos = r => { const d = bDur(r), p = ((Date.now() - bStart(r)) / 1000) % d; return p < 0 ? p + d : p; };
CATALOG.forEach((c, k) => rooms.set('botroom' + (k + 1), { id: 'botroom' + (k + 1), title: c.title, poster: 0, media: null, st: null, log: [], owner: null, ownerName: 'VIBE', members: new Map(), bot: c }));
const uniq = r => [...new Map([...r.members.values()].map(u => [u.id, u])).values()];
// участники комнаты для чата/глобуса: имя, цвет, аватарка и страна (пока клиент не прислал «geo» или если он скрыл место — страны нет)
const memList = r => {
  const seen = new Map();
  r.members.forEach((u, w) => { if (!seen.has(u.id)) seen.set(u.id, { name: u.name, color: u.color, u: u.id, ph: avUrl(u), hide: !w.geoOk || !!w.hide, cc: !w.geoOk || w.hide ? null : (w.cc || w.ccC || null) }); });
  return [...seen.values()];
};
const row = r => {
  const us = uniq(r), o = { id: r.id, title: r.title, poster: r.poster, media: r.media, count: us.length, users: us.slice(0, 5).map(u => [(u.name || '?')[0].toUpperCase(), u.color || 'p']) };
  if (r.bot) Object.assign(o, { bot: 1, base: r.bot.base, count: us.length + r.bot.base, dur: bDur(r), start: bStart(r), now: Date.now() });
  return o;
};
const send = (w, o) => w.readyState === 1 && w.send(JSON.stringify(o));
const toRoom = (r, o, except) => r.members.forEach((u, w) => w !== except && send(w, o));
const pushRooms = () => { const list = [...rooms.values()].map(row).sort((a, b) => b.count - a.count); socks.forEach(w => w.uid && send(w, { t: 'rooms', list })); };
const drop = r => { if (!r.bot && rooms.get(r.id) === r) { rooms.delete(r.id); pushRooms(); } };
const xfer = r => { if (r.bot || !rooms.has(r.id) || !r.members.size || uniq(r).some(x => x.id === r.owner)) return; const n = uniq(r)[0]; r.owner = n.id; r.ownerName = n.name; toRoom(r, { t: 'host', host: n.id, hn: n.name }); }; // основатель ушёл — права переходят следующему
function leave(w, instant) {
  tickStats(w);
  const r = rooms.get(w.room); w.room = null; if (!r || !r.members.delete(w)) return;
  if (!r.members.size) return r.bot ? pushRooms() : instant ? drop(r) : setTimeout(() => !r.members.size && drop(r), 3000); // обрыв связи: 3 c на переподключение
  setTimeout(() => xfer(r), instant ? 0 : 3000);
  toRoom(r, { t: 'mem', list: memList(r) }); pushRooms();
}

function botsChanged() {
  BD = botDurs();
  rooms.forEach(r => r.bot && toRoom(r, { t: 'bot', bot: { start: bStart(r), dur: bDur(r) }, now: Date.now() }));
  pushRooms();
}

// время в комнатах: раз в 20 c начисляем всем, кто сейчас в комнате
setInterval(() => { let any = false; socks.forEach(w => { if (w.room) { tickStats(w); any = true; } }); if (any) save(); }, 20000);

// эфир: раз в 10 c напоминаем всем зрителям бот-комнат текущую секунду фильма
setInterval(() => rooms.forEach(r => r.bot && r.members.size &&
  toRoom(r, { t: 'ctl', p: { a: 'play', t: bPos(r), ts: Date.now() } })), 10000);

/* ---- страница и картинки: сжатие (br/gzip), кэш в памяти, ETag ---- */
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.ico': 'image/x-icon' };
let PAGE = null;
const pageData = () => {
  const f = path.join(__dirname, 'index.html'), mt = fs.statSync(f).mtimeMs;
  if (!PAGE || PAGE.mt !== mt) { const raw = fs.readFileSync(f); PAGE = { mt, raw, gz: zlib.gzipSync(raw, { level: 9 }), br: zlib.brotliCompressSync(raw), tag: crypto.createHash('md5').update(raw).digest('hex') }; }
  return PAGE;
};
function sendPage(req, res) {
  let p; try { p = pageData(); } catch (_) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('index.html not found'); }
  const ae = String(req.headers['accept-encoding'] || ''), enc = /\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : '', body = enc === 'br' ? p.br : enc === 'gzip' ? p.gz : p.raw;
  const h = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'Vary': 'Accept-Encoding', 'ETag': '"' + p.tag + enc + '"' };
  if (enc) h['Content-Encoding'] = enc;
  if (req.headers['if-none-match'] === h.ETag) { res.writeHead(304, h); return res.end(); }
  h['Content-Length'] = body.length; res.writeHead(200, h); res.end(body);
}
function sendStatic(url, res) {   // только папка images/
  const dec = SEC.safeDecode(url); if (dec === null) return false;
  const rel = path.normalize(dec).replace(/^[\\/]+/, '');
  if (rel.includes('..') || !/^images[\\/]/.test(rel) || !MIME[path.extname(rel).toLowerCase()]) return false;
  const f = path.join(__dirname, rel); let st; try { st = fs.statSync(f); } catch (_) { return false; }
  if (!st.isFile()) return false;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()], 'Content-Length': st.size, 'Cache-Control': 'public, max-age=604800' });
  fs.createReadStream(f).pipe(res); return true;
}

/* ---- Telegram Bot API: оплата Premium (Stars), счётчик посетителей, команды админа ---- */
const tgApi = async (method, data) => {
  if (!TGT) return null;
  try { const r = await fetch('https://api.telegram.org/bot' + TGT + '/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) }); return await r.json(); }
  catch (e) { console.error('tg ' + method + ':', why(e)); return null; }
};
const dayKey = (t = Date.now()) => new Date(t).toLocaleDateString('sv-SE', { timeZone: TZ });   // YYYY-MM-DD в нужном часовом поясе
const dayOf = k => (db.stats.days[k] = db.stats.days[k] || { h: 0, v: {}, pay: 0, stars: 0 });
function hit(vid) {   // уникальный посетитель за день = уникальный vid из localStorage браузера (хранится только хэш)
  if (!/^[\w-]{8,48}$/.test(String(vid || ''))) return;
  const d = dayOf(dayKey()), id = crypto.createHash('sha1').update(vid).digest('hex').slice(0, 10);
  d.h++; if (!d.v[id] && Object.keys(d.v).length < 200000) d.v[id] = 1;
  const keys = Object.keys(db.stats.days).sort(); while (keys.length > 90) delete db.stats.days[keys.shift()];   // храним 90 дней
  save();
}
const uniqDays = n => { const s = new Set(); for (let i = 0; i < n; i++) { const d = db.stats.days[dayKey(Date.now() - i * 864e5)]; d && Object.keys(d.v).forEach(k => s.add(k)); } return s.size; };
function statsText() {
  const t = db.stats.days[dayKey()] || { h: 0, v: {}, pay: 0, stars: 0 }, y = db.stats.days[dayKey(Date.now() - 864e5)] || { h: 0, v: {}, pay: 0, stars: 0 }, now = Date.now();
  const us = Object.values(db.users), online = new Set([...socks].filter(w => w.uid).map(w => w.uid)).size, inRooms = new Set([...rooms.values()].filter(r => !r.bot).flatMap(r => uniq(r).map(u => u.id))).size;
  const newToday = us.filter(u => u.created && dayKey(u.created) === dayKey()).length, prem = us.filter(u => u.until && u.until > now).length;
  const allPay = Object.values(db.payments), totalStars = allPay.reduce((a, p) => a + (p.stars || 0), 0);
  return ['📊 VIBE — статистика', '',
    '👀 Посетителей сегодня: ' + Object.keys(t.v).length + ' (заходов: ' + t.h + ')',
    '↩️ Вчера: ' + Object.keys(y.v).length + ' (заходов: ' + y.h + ')',
    '📅 За 7 дней: ' + uniqDays(7) + ' · за 30 дней: ' + uniqDays(30), '',
    '🟢 Сейчас онлайн: ' + online + ' (в комнатах: ' + inRooms + ')',
    '👤 Аккаунтов: ' + us.length + ' (новых сегодня: ' + newToday + ')',
    '✨ Premium активен: ' + prem, '',
    '💳 Оплат сегодня: ' + t.pay + ' (' + t.stars + ' ⭐)',
    '💰 Всего оплат: ' + allPay.length + ' (' + totalStars + ' ⭐)'].join('\n');
}
const adminChats = () => {   // кому слать уведомления: админы по аккаунту (почта/@ник) + явные TG_ADMIN_IDS
  const ids = new Set(TGA); Object.values(db.users).forEach(u => u.tgId && isAdmin(u) && ids.add(u.tgId)); return [...ids];
};
const isTgAdmin = id => adminChats().includes(String(id));
const notifyAdmins = text => adminChats().forEach(id => tgApi('sendMessage', { chat_id: id, text }));

/* ---- Доступ только для подписчиков новостного канала ----
   Бот должен быть АДМИНИСТРАТОРОМ канала (права не нужны), иначе Telegram не отдаёт getChatMember.
   Переменные (необязательно): TG_CHANNEL=@vibeparty_new, SUB_REQUIRED=0 — выключить проверку. */
const SUB_CH = String(process.env.TG_CHANNEL || cfg.tgChannel || '@vibeparty_new').trim();
const SUB_ON = !!TGT && process.env.SUB_REQUIRED !== '0';
const subCache = new Map();   // tgId -> { ok, ts }
const subBypass = u => isAdmin(u) || (!!u.tgId && isTgAdmin(u.tgId));
async function isMember(tgId) {
  const k = String(tgId), c = subCache.get(k);
  if (c && Date.now() - c.ts < (c.ok ? 300000 : 8000)) return c.ok;   // подписан — помним 5 мин, нет — перепроверка через 8 c
  const r = await tgApi('getChatMember', { chat_id: SUB_CH, user_id: +tgId });
  if (r && r.ok && r.result) {
    const st = r.result.status, ok = st === 'creator' || st === 'administrator' || st === 'member' || (st === 'restricted' && r.result.is_member === true);
    subCache.set(k, { ok, ts: Date.now() }); return ok;
  }
  if (r && /user not found|PARTICIPANT_ID_INVALID/i.test(r.description || '')) { subCache.set(k, { ok: false, ts: Date.now() }); return false; }
  console.error('sub check:', r ? r.description : 'нет ответа от Telegram', '— бот должен быть админом канала ' + SUB_CH);
  if (c && c.ok) return true;   // Telegram временно недоступен — не выкидываем тех, кого уже проверили
  throw new Error('sub_check_failed');
}
const subTgId = u => u.tgId || u.subTg || null;   // subTg — ID, подтверждённый кнопкой «Старт» в боте (без входа через виджет)
const subState = async u => {
  if (!SUB_ON || subBypass(u)) return { tg: true, subscribed: true };
  const id = subTgId(u); if (!id) return { tg: false, subscribed: false };
  return { tg: true, subscribed: await isMember(id) };
};
const subCodes = new Map();   // одноразовые коды для ссылки t.me/бот?start=sub_КОД
function subLink(u) {
  if (!TGN) return '';
  for (const [k, v] of subCodes) if (v.uid === u.id || Date.now() - v.ts > 6e5) subCodes.delete(k);
  const code = rid(8); subCodes.set(code, { uid: u.id, ts: Date.now() });
  return 'https://t.me/' + TGN + '?start=sub_' + code;
}
async function subStart(msg, code) {   // человек нажал «Старт» по ссылке с сайта
  const c = subCodes.get(code), user = c && Date.now() - c.ts < 6e5 && db.users[c.uid], from = msg.from && msg.from.id;
  if (!user || !from) return tgApi('sendMessage', { chat_id: msg.chat.id, text: 'Ссылка устарела. Вернитесь на сайт vibe и нажмите «Подтвердить в боте» ещё раз.' });
  subCodes.delete(code); user.subTg = String(from); subCache.delete(String(from)); flushDb();
  let ok = false; try { ok = SUB_ON ? await isMember(from) : true; } catch (_) { return tgApi('sendMessage', { chat_id: msg.chat.id, text: 'Не получилось проверить подписку. Попробуйте через минуту.' }); }
  return tgApi('sendMessage', ok
    ? { chat_id: msg.chat.id, text: '✅ Подписка подтверждена! Возвращайтесь на сайт — vibe уже открыт.' }
    : { chat_id: msg.chat.id, text: 'Аккаунт подтверждён, но вы ещё не подписаны на канал. Подпишитесь и вернитесь на сайт.', reply_markup: { inline_keyboard: [[{ text: 'Подписаться на канал', url: 'https://t.me/' + SUB_CH.replace(/^@/, '') }]] } });
}
const PAYLOAD = /^prem:([0-9a-f]+)$/;
async function createInvoice(user) {
  const r = await tgApi('createInvoiceLink', { title: 'VIBE Premium · 30 дней', description: 'Статистика, оформление чата, редактирование сообщений и другие возможности на 30 дней', payload: 'prem:' + user.id, provider_token: '', currency: 'XTR', prices: [{ label: 'VIBE Premium', amount: STARS }] });
  return r && r.ok ? r.result : null;
}
function grantPremium(user, charge, stars) {
  const base = Math.max(Date.now(), user.until || 0); user.until = base + 30 * 864e5;
  db.payments[charge] = { uid: user.id, stars, at: Date.now() };
  const d = dayOf(dayKey()); d.pay++; d.stars += stars;
  flushDb();   // деньги получены — на диск немедленно
  notifyAdmins('💳 Новая оплата Premium: ' + stars + ' ⭐\nПользователь: ' + (user.name || '?') + (user.tgUser ? ' (@' + user.tgUser + ')' : '') + '\nАктивен до: ' + new Date(user.until).toLocaleDateString('ru-RU', { timeZone: TZ }));
  [...socks].forEach(w => w.uid === user.id && send(w, { t: 'premium', user: pub(user) }));
}
async function onUpdate(u) {
  if (u.pre_checkout_query) {
    const q = u.pre_checkout_query, m = PAYLOAD.exec(q.invoice_payload || ''), ok = !!(m && db.users[m[1]] && q.currency === 'XTR' && q.total_amount === STARS);
    return tgApi('answerPreCheckoutQuery', ok ? { pre_checkout_query_id: q.id, ok: true } : { pre_checkout_query_id: q.id, ok: false, error_message: 'Не удалось проверить заказ, попробуйте ещё раз на сайте' });
  }
  const msg = u.message; if (!msg) return;
  const sp = msg.successful_payment;
  if (sp) {
    const m = PAYLOAD.exec(sp.invoice_payload || ''), user = m && db.users[m[1]], charge = sp.telegram_payment_charge_id;
    if (!user || !charge) return console.error('payment без пользователя:', JSON.stringify(sp));
    if (!db.payments[charge]) grantPremium(user, charge, sp.total_amount);   // повторная доставка апдейта не продлевает дважды
    return tgApi('sendMessage', { chat_id: msg.chat.id, text: '✨ Спасибо! VIBE Premium активирован до ' + new Date(user.until).toLocaleDateString('ru-RU', { timeZone: TZ }) + '. Возвращайтесь на сайт — всё уже включено.' });
  }
  const sm = /^\/start(?:@\w+)?\s+sub_([0-9a-f]+)$/i.exec(String(msg.text || '').trim()); if (sm) return subStart(msg, sm[1].toLowerCase());
  const text = String(msg.text || '').trim().split(/[\s@]/)[0].toLowerCase(), from = msg.from && msg.from.id;
  if (text === '/start') return tgApi('sendMessage', { chat_id: msg.chat.id, text: 'VIBE — совместный просмотр. Этот бот принимает оплату Premium и присылает админам статистику.' + (isTgAdmin(from) ? '\n\nКоманды админа: /stats — статистика, /backup — скачать data.json' : '') });
  if (!isTgAdmin(from)) return;
  if (text === '/stats') return tgApi('sendMessage', { chat_id: msg.chat.id, text: statsText() });
  if (text === '/backup') {
    flushDb(); const fd = new FormData(); fd.append('chat_id', String(msg.chat.id)); fd.append('document', new Blob([fs.readFileSync(DBF)]), 'data-' + dayKey() + '.json');
    try { await fetch('https://api.telegram.org/bot' + TGT + '/sendDocument', { method: 'POST', body: fd }); } catch (e) { console.error('backup:', e.message); }
  }
}
let tgOff = 0;
async function tgPoll() {   // long polling: не нужен публичный webhook
  await tgApi('deleteWebhook', {});
  tgApi('setMyCommands', { commands: [{ command: 'start', description: 'О боте' }, { command: 'stats', description: 'Статистика (для админов)' }, { command: 'backup', description: 'Скачать базу (для админов)' }] });
  for (;;) {
    const r = await tgApi('getUpdates', { offset: tgOff, timeout: 50, allowed_updates: ['message', 'pre_checkout_query'] });
    if (!r || !r.ok) { await new Promise(z => setTimeout(z, 5000)); continue; }   // 409 при одновременном деплое двух копий — просто ждём
    for (const up of r.result) { tgOff = up.update_id + 1; try { await onUpdate(up); } catch (e) { console.error('update:', e.message); } }
  }
}

/* ---- друзья, ники, профили, заявки, мини-чат (данные живут в db → data.json и Supabase) ---- */
const TRL = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ы: 'y', э: 'e', ю: 'yu', я: 'ya' };
const slugNick = s => String(s || '').toLowerCase().split('').map(c => TRL[c] !== undefined ? TRL[c] : c).join('').replace(/[^a-z0-9_.]+/g, '.').replace(/^[._]+|[._]+$/g, '').slice(0, 24);
const NICK_RE = /^[a-z0-9_.]{3,24}$/;
const nickTaken = (n, except) => Object.values(db.users).some(x => x.nick === n && x.id !== except);
function nickOf(x) {
  if (!x.nick) {
    let b = slugNick(x.tgUser) || slugNick(x.name); if (b.length < 3) b = 'user' + String(x.id).slice(-5);
    let n = b, i = 1; while (nickTaken(n, x.id)) n = (b.slice(0, 20) + (++i) + Math.floor(Math.random() * 90)).slice(0, 24);
    x.nick = n; save();
  }
  return x.nick;
}
const sPub = (x, full) => ({ id: x.id, username: nickOf(x), name: x.name || 'Без имени', color: x.color || 'p', photo: typeof x.photo === 'string' && (/^https?:/.test(x.photo) || full || x.photo.length < 30000) ? x.photo : null });
const sFr = x => x.fr || (x.fr = []);
const sKey = (a, b) => a < b ? a + '|' + b : b + '|' + a;
const sThread = (a, b) => { db.chats = db.chats || {}; return db.chats[sKey(a, b)] || (db.chats[sKey(a, b)] = []); };
const sUnread = (me, peer) => { const rd = (me.rd || {})[peer.id] || 0; return sThread(me.id, peer.id).filter(m => m.from === peer.id && m.id > rd).length; };
const sRel = (me, o) => {
  if (me.id === o.id) return 'self';
  if (sFr(me).includes(o.id)) return 'friend';
  if (db.reqs.some(r => r.from === me.id && r.to === o.id)) return 'outgoing';
  if (db.reqs.some(r => r.from === o.id && r.to === me.id)) return 'incoming';
  return 'none';
};
function sMakeFriends(a, b) {
  if (!sFr(a).includes(b.id)) sFr(a).push(b.id); if (!sFr(b).includes(a.id)) sFr(b).push(a.id);
  db.reqs = db.reqs.filter(r => !((r.from === a.id && r.to === b.id) || (r.from === b.id && r.to === a.id)));
}
function socialApi(req, url, b, me, out) {
  db.chats = db.chats || {}; db.reqs = db.reqs || [];
  const sp = new URL(req.url, 'http://x').searchParams, sub = url.slice('/api/social'.length).split('/').filter(Boolean).map(s => SEC.safeDecode(s) || '');
  const find = n => { n = String(n || '').replace(/^@/, '').toLowerCase().trim(); return Object.values(db.users).find(x => nickOf(x) === n); };
  const byId = id => SEC.isId(id) ? db.users[id] : undefined;
  if (sub[0] === 'state') {
    const un = {}; let tot = 0;
    sFr(me).map(byId).filter(Boolean).forEach(f => { const n = sUnread(me, f); if (n) { un[nickOf(f)] = n; tot += n; } });
    return out(200, {
      me: { id: me.id, username: nickOf(me) },
      friends: sFr(me).map(byId).filter(Boolean).map(f => sPub(f)),
      incoming: db.reqs.filter(r => r.to === me.id).map(r => byId(r.from)).filter(Boolean).map(f => sPub(f)),
      outgoing: db.reqs.filter(r => r.from === me.id).map(r => byId(r.to)).filter(Boolean).map(nickOf),
      unread: un, unreadTotal: tot
    });
  }
  if (sub[0] === 'search') {
    const q = String(sp.get('q') || '').replace(/^@/, '').toLowerCase().trim().slice(0, 40);
    if (q.length < 2) return out(200, { list: [] });
    const list = Object.values(db.users).filter(x => x.id !== me.id).map(x => ({ x, n: nickOf(x) }))
      .filter(o => o.n.includes(q) || String(o.x.name || '').toLowerCase().includes(q))
      .sort((a, c) => (c.n === q) - (a.n === q) || c.n.startsWith(q) - a.n.startsWith(q) || a.n.length - c.n.length)
      .slice(0, 20).map(o => Object.assign(sPub(o.x), { rel: sRel(me, o.x) }));
    return out(200, { list });
  }
  if (sub[0] === 'user' && sub[1]) {
    const x = find(sub[1]); if (!x) return out(404, { error: 'Пользователь не найден' });
    return out(200, { user: Object.assign(sPub(x, true), { bio: String(x.bio || '').slice(0, 300), rel: sRel(me, x), friendsCount: sFr(x).length, gallery: (x.gallery || []).slice(0, 6), created: x.created || null, stats: statsPub(x, [...socks].some(w => w.uid === x.id)), hid: x.prefs && x.prefs.S && Array.isArray(x.prefs.S.hid) ? x.prefs.S.hid : [] }) });
  }
  if (sub[0] === 'username' && req.method === 'POST') {
    const n = String(b.username || '').replace(/^@/, '').toLowerCase().trim();
    if (!NICK_RE.test(n)) return out(400, { error: 'Ник: 3–24 символа, латиница, цифры, точка и _' });
    if (nickTaken(n, me.id)) return out(409, { error: 'Этот ник занят' });
    me.nick = n; save(); return out(200, { ok: true, username: n });
  }
  if (req.method === 'POST' && ['request', 'accept', 'decline', 'cancel', 'remove'].includes(sub[0])) {
    const x = find(b.username); if (!x || x.id === me.id) return out(404, { error: 'Пользователь не найден' });
    const r = sRel(me, x);
    if (sub[0] === 'request') {
      if (r === 'friend') return out(200, { ok: true, rel: r });
      if (r === 'incoming') { sMakeFriends(me, x); save(); return out(200, { ok: true, rel: 'friend' }); }   // встречные заявки — сразу дружба
      if (r === 'none') { if (db.reqs.filter(z => z.from === me.id).length >= 100) return out(429, { error: 'Слишком много заявок' }); db.reqs.push({ from: me.id, to: x.id, ts: Date.now() }); save(); }
      return out(200, { ok: true, rel: 'outgoing' });
    }
    if (sub[0] === 'accept') { if (r !== 'incoming') return out(400, { error: 'Заявки нет' }); sMakeFriends(me, x); save(); return out(200, { ok: true }); }
    if (sub[0] === 'decline') { db.reqs = db.reqs.filter(z => !(z.from === x.id && z.to === me.id)); save(); return out(200, { ok: true }); }
    if (sub[0] === 'cancel') { db.reqs = db.reqs.filter(z => !(z.from === me.id && z.to === x.id)); save(); return out(200, { ok: true }); }
    if (sub[0] === 'remove') { me.fr = sFr(me).filter(i => i !== x.id); x.fr = sFr(x).filter(i => i !== me.id); save(); return out(200, { ok: true }); }
  }
  if (sub[0] === 'chat' && sub[1]) {
    const x = find(sub[1]); if (!x) return out(404, { error: 'Пользователь не найден' });
    if (!sFr(me).includes(x.id)) return out(403, { error: 'Чат доступен только друзьям' });
    const t = sThread(me.id, x.id), last = t.length ? t[t.length - 1].id : 0;
    me.rd = me.rd || {};
    if (req.method === 'POST') {
      const text = SEC.cleanText(b.text, 1000); if (!text) return out(400, { error: 'Пустое сообщение' });
      const m = { id: last + 1, from: me.id, text, ts: Date.now() }; t.push(m); if (t.length > 300) t.splice(0, t.length - 300);
      me.rd[x.id] = m.id; save(); return out(200, { ok: true, msg: { id: m.id, mine: true, text, ts: m.ts } });
    }
    const since = +sp.get('since') || 0;
    const list = t.filter(m => m.id > since).slice(-200).map(m => ({ id: m.id, mine: m.from === me.id, text: m.text, ts: m.ts }));
    if ((me.rd[x.id] || 0) < last) { me.rd[x.id] = last; save(); }
    return out(200, { list });
  }
  return out(404, { error: 'not found' });
}

/* ---- HTTP ---- */
const body = SEC.readBody;   // лимит размера, ошибки 400/413 приходят в общий обработчик
const auth = req => db.users[db.tokens[(req.headers.authorization || '').slice(7)]];
const server = http.createServer((req, res) => {
  SEC.applySecurityHeaders(res);
  handle(req, res).catch(e => SEC.sendError(res, e));   // любая ошибка → ответ, а не падение процесса
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
/* ---- обложки по ссылке (YouTube / Rutube / VK): сервер сам ходит на площадку, браузеру CORS не мешает ---- */
const THUMBC = new Map(), THUMBRL = new Map();
let thumbBusy = 0;
const unesc = x => String(x || '').replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
const ogMeta = (html, p) => {
  const m = html.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + p + '["\'][^>]+content=["\']([^"\']+)', 'i'))
         || html.match(new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']' + p + '["\']', 'i'));
  return m ? unesc(m[1]) : '';
};
const getUrl = u => fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VibeBot/1.0)', 'Accept-Language': 'ru,en;q=0.8' }, signal: AbortSignal.timeout(5000) }).then(r => r.ok ? r : null).catch(() => null);
async function lookupThumb(q) {
  const type = q.type, id = String(q.id || ''), oid = String(q.oid || ''), hash = String(q.hash || ''), p = String(q.p || '');
  if (type === 'yt') {
    if (!/^[\w-]{11}$/.test(id)) return {};
    const r = await getUrl('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id)), j = r ? await r.json().catch(() => ({})) : {};
    return { thumb: 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg', title: j.title || '' };
  }
  if (type === 'rt') {
    if (!/^[0-9a-f]{32}$/i.test(id) || (p && !/^[\w-]{1,64}$/.test(p))) return {};
    let r = await getUrl('https://rutube.ru/api/video/' + id + '/' + (p ? '?p=' + p : '')), j = r ? await r.json().catch(() => ({})) : {};
    if (!j.thumbnail_url) { r = await getUrl('https://rutube.ru/api/oembed/?format=json&url=' + encodeURIComponent('https://rutube.ru/video/' + id + '/')); j = r ? await r.json().catch(() => ({})) : {}; }
    return { thumb: j.thumbnail_url || '', title: j.title || '' };
  }
  if (type === 'vk') {
    if (!/^-?\d{1,12}$/.test(oid) || !/^\d{1,12}$/.test(id) || (hash && !/^\w{1,40}$/.test(hash))) return {};
    const r = await getUrl('https://vk.com/video_ext.php?oid=' + oid + '&id=' + id + (hash ? '&hash=' + hash : '')), html = r ? await r.text() : '';
    let thumb = ogMeta(html, 'og:image');
    if (!thumb) { const m = html.match(/"(?:jpg|poster|photo_\d+|thumb)"\s*:\s*"(https?:[^"]+?\.jpg[^"]*)"/i); thumb = m ? unesc(m[1]) : ''; }
    return { thumb, title: ogMeta(html, 'og:title') };
  }
  return {};
}
async function thumbRoute(req, out) {
  const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(), now = Date.now(), rl = THUMBRL.get(ip) || { n: 0, t: now };
  if (now - rl.t > 60000) { rl.n = 0; rl.t = now; } rl.n++; THUMBRL.set(ip, rl); if (THUMBRL.size > 5000) THUMBRL.clear();
  if (rl.n > 40) return out(429, {});
  const key = [q.type, q.oid, q.id].join('|'), hit = THUMBC.get(key);
  if (hit && now - hit.t < 6 * 3600e3) return out(200, hit.d);
  if (thumbBusy >= 8) return out(200, {});
  thumbBusy++;
  try {
    const d = await lookupThumb(q);
    if (d.thumb && !/^https:\/\//.test(d.thumb)) d.thumb = d.thumb.replace(/^http:/, 'https:');
    if (d.thumb) { THUMBC.set(key, { t: now, d }); if (THUMBC.size > 2000) THUMBC.delete(THUMBC.keys().next().value); }
    return out(200, d);
  } catch (_) { return out(200, {}); } finally { thumbBusy--; }
}
/* thumb в media — только https-адрес (или наш images/), иначе выкидываем: он попадёт в <img src> всем зрителям */
const cleanMedia = m => { if (!m || typeof m !== 'object') return null; if ('thumb' in m && !(typeof m.thumb === 'string' && /^(https:\/\/[^\s"'<>\\]{4,500}|images\/[\w.%+-]{1,100})$/.test(m.thumb))) delete m.thumb; return m; };

async function handle(req, res) {
  const url = req.url.split('?')[0];
  const out = (c, o) => {
    res.writeHead(c, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': FRONT || '*', 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
    res.end(JSON.stringify(o));
  };
  if (req.method === 'OPTIONS') return out(204, {});
  if (process.env.TRUST_PROXY === '1' && url.startsWith('/api/') && !SEC.rateLimit('all:' + SEC.clientIp(req), 600, 60e3)) return out(429, { error: 'Слишком много запросов, подождите минуту' });   // защита от флуда/перебора
  if (url === '/api/tg-cb') {   // Telegram Login Widget в режиме редиректа (работает на телефоне и в PWA, где popup блокируется)
    const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams), r = tgVerify(q) ? tgUpsert(q, null) : null;
    if (!r || !r.user) { res.writeHead(302, { Location: FRONT + '/#tgerr' }); return res.end(); }
    const token = rid(24); db.tokens[token] = r.user.id; flushDb();
    res.writeHead(302, { Location: FRONT + '/#tg=' + token, 'Cache-Control': 'no-store' }); return res.end();
  }
  if (req.method === 'GET' && url.startsWith('/api/avatar/')) {
    const aid = SEC.safeDecode(url.slice(12)), usr = SEC.isId(aid) ? db.users[aid] : null, ph = usr && usr.photo;
    const m = typeof ph === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(ph);
    if (!m) { res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); return res.end(); }
    const buf = Buffer.from(m[2], 'base64');
    res.writeHead(200, { 'Content-Type': 'image/' + (m[1] === 'jpg' ? 'jpeg' : m[1]), 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff' });
    return res.end(buf);
  }
  if (!url.startsWith('/api/')) return (req.method === 'GET' && sendStatic(url, res)) || sendPage(req, res);
  if (url === '/api/thumb' && req.method === 'GET') return thumbRoute(req, out);   // публичный: обложка + название по ссылке
  const b = req.method === 'POST' ? await body(req) : {}, u = auth(req);
  const login = user => { const token = rid(24); db.tokens[token] = user.id; flushDb(); out(200, { token, user: pub(user) }); };
  if (url === '/api/config') return out(200, { tgBot: TGT && TGN ? TGN : '', tgApp: TGAPP, pay: !!TGT, price: STARS + ' ⭐', captcha: CAPTCHA_ON ? TSK : '' });
  if (url === '/api/hit') { hit(b.vid); return out(200, {}); }   // счётчик посетителей (без авторизации)
  if (url === '/api/register') {
    if (!SEC.rateLimit('reg:' + SEC.clientIp(req), 5, 3600e3)) return out(429, { error: 'Слишком много регистраций, попробуйте позже' });
    if (!(await captchaOk(b.captcha, SEC.clientIp(req)))) return out(400, { error: 'captcha' });
    const em = String(b.email || '').trim().toLowerCase(), nm = SEC.cleanText(b.name, 30), pw = String(b.password || '');
    if (!SEC.RE.email.test(em) || pw.length < 6 || pw.length > 200 || !nm) return out(400, { error: 'Заполните почту, имя и пароль (от 6 до 200 символов)' });
    if (Object.values(db.users).some(x => x.email === em)) return out(409, { error: 'Почта уже занята' });
    const salt = rid(8), user = { id: rid(6), email: em, salt, pass: hash(pw, salt), name: nm, color: 'p', friends: [], created: Date.now() }; db.users[user.id] = user; return login(user);
  }
  if (url === '/api/login') {
    const em = String(b.email || '').trim().toLowerCase(), pw = String(b.password || '').slice(0, 200);
    if (!SEC.rateLimit('login:' + SEC.clientIp(req), 10, 15 * 60e3) || !SEC.rateLimit('loginmail:' + em, 10, 15 * 60e3))
      return out(429, { error: 'Слишком много попыток, подождите 15 минут' });
    if (!(await captchaOk(b.captcha, SEC.clientIp(req)))) return out(400, { error: 'captcha' });
    const user = Object.values(db.users).find(x => x.email === em);
    if (!user) return out(404, { error: 'nouser' });
    return SEC.safeEq(hash(pw, user.salt), user.pass) ? login(user) : out(401, { error: 'Неверный пароль' });
  }
  if (url === '/api/tg') {   // вход / регистрация / привязка через Telegram
    if (!TGT) return out(400, { error: 'Telegram не настроен на сервере' });
    if (!tgVerify(b)) return out(401, { error: 'Не удалось подтвердить Telegram' });
    const r = tgUpsert(b, u); if (r.error) return out(409, { error: r.error }); const user = r.user;
    return login(user);
  }
  if (url === '/api/tg-app') {   // внутри Mini App: вход ТОЛЬКО в уже существующий аккаунт, привязанный к этому Telegram; новые аккаунты здесь не создаются
    const tu = tgInitVerify(b.initData); if (!tu) return out(401, { error: 'Не удалось подтвердить Telegram' });
    const user = Object.values(db.users).find(x => x.tgId === String(tu.id)); if (!user) return out(404, { error: 'nouser' });
    return login(user);
  }
  if (!u) return out(401, { error: 'auth' });
  if (url === '/api/delete-account' && req.method === 'POST') {   // удаление аккаунта: доступно всегда (даже без подписки на канал)
    if (String(b.confirm || '').trim().toUpperCase() !== 'УДАЛИТЬ') return out(400, { error: 'Подтвердите удаление' });
    const id = u.id;
    rdel('u:' + id);
    for (const [t, owner] of Object.entries(db.tokens)) if (owner === id) { delete db.tokens[t]; rdel('t:' + t); }   // все входы человека на всех устройствах
    Object.values(db.users).forEach(x => { if (x.id === id) return; if (Array.isArray(x.fr)) x.fr = x.fr.filter(i => i !== id); if (x.rd) delete x.rd[id]; });   // из списков друзей и «прочитано» других
    db.reqs = (db.reqs || []).filter(r => r.from !== id && r.to !== id);
    for (const k of Object.keys(db.chats || {})) if (k.split('|').includes(id)) { delete db.chats[k]; rdel('c:' + k); }   // личные переписки
    Object.values(db.payments).forEach(p => { if (p.uid === id) p.uid = null; });   // записи об оплатах остаются для учёта, но без привязки к человеку
    for (const [c, v] of subCodes) if (v.uid === id) subCodes.delete(c);
    delete db.users[id]; avCache.delete(id);
    [...socks].forEach(w => { if (w.uid === id) { try { w.close(4001); } catch (_) {} } });   // выкидываем из комнат; хост комнаты перейдёт следующему
    flushDb(); return out(200, { ok: true });
  }
  if (url === '/api/sub') {   // экран подписки на сайте опрашивает этот адрес
    try { const st = await subState(u); return out(200, { ok: true, ...st, channel: SUB_CH, link: st.tg ? '' : subLink(u) }); } catch (_) { return out(503, { ok: false, error: 'sub_check_failed' }); }
  }
  if (SUB_ON && url !== '/api/me' && url !== '/api/profile') {   // всё остальное — только для подписчиков
    let st; try { st = await subState(u); } catch (_) { return out(503, { error: 'sub_check_failed' }); }
    if (!st.subscribed) return out(403, { error: 'sub_required' });
  }
  if (url.startsWith('/api/social')) return socialApi(req, url, b, u, out);
  if (url === '/api/me') return out(200, { user: pub(u) });
  if (url === '/api/profile') {   // частичное обновление: приходят только изменённые поля, остальное не затирается
    if ('name' in b) { const n = SEC.cleanText(b.name, 30); if (n) u.name = n; }
    if ('bio' in b) u.bio = SEC.cleanText(b.bio, 300);
    if ('color' in b && /^[pkobg]$/.test(String(b.color))) u.color = b.color;
    if ('photo' in b) u.photo = typeof b.photo === 'string' && b.photo.length < 600000 && /^(data:image\/|https?:\/\/)/.test(b.photo) ? b.photo : null;
    if ('gallery' in b) u.gallery = Array.isArray(b.gallery) ? b.gallery.filter(g => typeof g === 'string' && g.length < 250000 && /^data:image\//.test(g)).slice(0, 6) : [];
    if (b.prefs && typeof b.prefs === 'object' && !Array.isArray(b.prefs)) { const j = JSON.stringify(b.prefs); if (j.length < 60000) u.prefs = b.prefs; }   // настройки, скрытые строки, вкладки, блок-лист
    flushDb(); return out(200, { user: pub(u) });   // пишем на диск сразу
  }
  if (url === '/api/friends') { u.friends = Array.isArray(b.friends) && JSON.stringify(b.friends).length < 100000 ? b.friends : []; save(); return out(200, {}); }
  if (url === '/api/pay') {   // ссылка на счёт в Telegram Stars; Premium выдаётся только после успешной оплаты (см. onUpdate)
    if (!TGT) return out(400, { error: 'Оплата не настроена на сервере (TG_BOT_TOKEN)' });
    const link = await createInvoice(u); return link ? out(200, { link, price: STARS }) : out(502, { error: 'Не удалось создать счёт, попробуйте позже' });
  }
  if (url === '/api/premium') {   // бесплатная выдача — только админу, для проверки
    if (!isAdmin(u)) return out(403, { error: 'Оплата через Telegram: нажмите «Оформить»' });
    u.until = Math.max(Date.now(), u.until || 0) + 30 * 864e5; flushDb(); return out(200, { user: pub(u) });
  }
  if (url === '/api/bots') {   // ссылки на видео для бот-комнат: { "Название фильма": "https://vk.com/video-1_2?hash=..." }
    if (req.method === 'GET') return out(200, { bots: botLinks(), durs: botDurs() });
    if (!isAdmin(u)) return out(403, { error: 'Только для администратора (ADMIN_EMAILS)' });
    const nb = SEC.dict();
    for (const [k, v] of Object.entries(b.bots || {})) {
      if (!SEC.safeKey(k) || k === '__durs') return out(400, { error: 'Недопустимое название' });
      const raw = String(v || '').trim();
      if (raw && !SEC.safeVideoUrl(raw)) return out(400, { error: 'Ссылка для «' + k + '» не поддерживается' });
      nb[String(k).slice(0, 60)] = raw ? SEC.safeVideoUrl(raw) : '';
    }
    const nd = SEC.dict(), src = b.durs === undefined ? botDurs() : b.durs;
    for (const [k, v] of Object.entries(src || {})) { if (!SEC.safeKey(k)) continue; const x = Math.round(+v); if (x >= 1 && x <= 600) nd[String(k).slice(0, 60)] = x; }
    const file = Object.assign({}, nb, { __durs: nd });
    fs.writeFileSync(BOTF + '.tmp', JSON.stringify(file, null, 2)); fs.renameSync(BOTF + '.tmp', BOTF); schedRemote(); botsChanged();
    return out(200, { bots: nb, durs: nd });
  }
  if (url === '/api/rooms' && req.method === 'GET') return out(200, { list: [...rooms.values()].map(row) });
  if (url === '/api/rooms') {
    const r = { id: rid(5), title: SEC.cleanText(b.title, 60) || 'Комната', poster: +b.poster || 0, media: cleanMedia(b.media), st: null, log: [], owner: u.id, ownerName: u.name, members: new Map() };
    rooms.set(r.id, r); pushRooms(); setTimeout(() => !r.members.size && drop(r), 15000); // создатель должен зайти в течение 15 c
    return out(200, { room: { id: r.id } });
  }
  out(404, { error: 'not found' });
}

/* ---- WebSocket ---- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', (w, req) => {
  const u = db.users[db.tokens[new URL(req.url, 'http://x').searchParams.get('token')]];
  if (!u) return w.close(4001);
  subState(u).then(st => { if (!st.subscribed) w.close(4403); }).catch(() => w.close(4403));   // не подписан — в комнаты не пускаем
  w.uid = u.id; w.room = null; socks.add(w); w.cc = cfCC(req);
  if (!w.cc) geoLookup(req).then(cc => { if (cc && w.readyState === 1) { w.cc = cc; const gr = rooms.get(w.room); if (gr) toRoom(gr, { t: 'mem', list: memList(gr) }); } });
  send(w, { t: 'rooms', list: [...rooms.values()].map(row) });
  w.on('message', async raw => {
    let m; try { m = JSON.parse(raw); } catch (_) { return; }
    if (!m || typeof m !== 'object') return;
    try { if (!(await subState(u)).subscribed) return w.close(4403); } catch (_) { return w.close(4403); }
    if (m.t === 'join') {
      const r = rooms.get(m.room); if (!r) return send(w, { t: 'err', msg: 'Комната закрыта' });
      if (w.room && w.room !== r.id) leave(w, true);
      w.room = r.id; r.members.set(w, u); w.tk = Date.now(); w.sess = 0;
      if (!r.bot) { const n = uniq(r).length; uniq(r).forEach(x => { const s = statOf(x); if (n > s.biggest) s.biggest = n; }); save(); }   // «самая большая комната» — по живым людям
      const ex = r.bot ? { bot: { start: bStart(r), dur: bDur(r) }, st: { a: 'play', t: bPos(r), ts: Date.now() } } : {};   // бот-комната: сразу текущая секунда фильма
      send(w, Object.assign({ t: 'init', room: r.id, t0: m.t0, h: Date.now(), title: r.title, media: r.media, log: r.log.slice(-100), st: r.st, host: r.owner, hn: r.ownerName }, ex));
      toRoom(r, { t: 'mem', list: memList(r) }); pushRooms(); return;
    }
    if (m.t === 'leave') return leave(w, true);
    if (m.t === 'geo') {   // клиент сообщает страну (запасной вариант по часовому поясу) и флаг «скрыть местоположение»
      w.ccC = /^[A-Za-z]{2}$/.test(String(m.cc || '')) ? String(m.cc).toUpperCase() : null; w.hide = !!m.hide; w.geoOk = true;
      const gr = rooms.get(w.room); if (gr) toRoom(gr, { t: 'mem', list: memList(gr) }); return;
    }
    const r = rooms.get(w.room); if (!r) return;
    if (r.bot && (m.t === 'ctl' || m.t === 'media')) return; // эфир: никто не ставит на паузу и не перематывает
    if ((m.t === 'ctl' || m.t === 'media') && u.id !== r.owner && r.media && (r.media.type === 'vk' || r.media.type === 'rt')) return; // VK/Rutube: управляет только основатель; YouTube и пустые комнаты — как раньше
    if (m.t === 'ctl') { r.st = { a: m.a === 'play' ? 'play' : 'pause', t: +m.p || 0, ts: Date.now() }; toRoom(r, { t: 'ctl', p: r.st }, w); }
    else if (m.t === 'chat') { const text = SEC.cleanText(m.text, 300); if (!text) return; const msg = { id: rid(4), u: u.id, name: u.name, color: u.color, premium: !!(u.until && u.until > Date.now()), ph: avUrl(u), text }; r.log.push(msg); if (r.log.length > 200) r.log.shift(); toRoom(r, { t: 'chat', m: msg }); }
    else if (m.t === 'edit') { const x = r.log.find(z => z.id === m.id && z.u === u.id); if (x) { x.text = SEC.cleanText(m.text, 300); toRoom(r, { t: 'edit', id: x.id, text: x.text }); } }
    else if (m.t === 'media') { r.media = cleanMedia(m.media); r.title = SEC.cleanText(m.title || r.title, 60); r.st = null; toRoom(r, { t: 'media', media: r.media, title: r.title }, w); pushRooms(); }
  });
  w.on('close', () => { socks.delete(w); leave(w, false); });
});
(async () => {
  if (REMOTE) { try { await loadRemote(); } catch (e) { console.error('Supabase недоступен — остановка, чтобы не потерять данные:', e.message); process.exit(1); } schedRemote(); }
  else console.warn('ВНИМАНИЕ: SUPABASE_URL/SUPABASE_KEY не заданы — данные только в data.json (на бесплатном Render он стирается)');
  { let fix = 0; Object.values(db.users).forEach(x => { if (!x.created) { x.created = Date.now(); fix++; } }); if (fix) { console.log('Старым аккаунтам без даты регистрации проставлена сегодняшняя: ' + fix); save(); } }   // у кого даты не было — отсчёт «с нами с» пойдёт с сегодняшнего дня
  server.listen(PORT, () => console.log('vibe: http://localhost:' + PORT + (TGT ? ' · бот включён' : ' · бот НЕ настроен (TG_BOT_TOKEN)') + (REMOTE ? ' · Supabase' : '')));
  if (TGT) tgPoll();
})();
