// npm i ws && node server.js   (index.html лежит рядом)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws'), zlib = require('zlib');
const PORT = process.env.PORT || 3000, DIR = process.env.DATA_DIR || __dirname, DBF = path.join(DIR, 'data.json'); // DATA_DIR — папка на постоянном диске хостинга, иначе вход слетает при каждом перезапуске
/* Настройки: переменные окружения ИЛИ файл config.json рядом с server.js:
   { "tgToken": "123456:AA...(токен из BotFather)", "tgName": "my_vibe_bot", "admins": ["you@mail.com"] } */
const cfg = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch (_) { return {}; } })();
const TGT = process.env.TG_BOT_TOKEN || cfg.tgToken || '', TGN = String(process.env.TG_BOT_NAME || cfg.tgName || '').replace(/^@/, '');
const ADMIN = String(process.env.ADMIN_EMAILS || [].concat(cfg.admins || []).join(',')).toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
const BOTF = path.join(DIR, 'bots.json'), bots = () => { try { return JSON.parse(fs.readFileSync(BOTF, 'utf8')); } catch (_) { return {}; } };
// bots.json: { "Название": "ссылка", "__durs": { "Название": минуты } }
const botLinks = () => { const o = bots(); delete o.__durs; return o; }, botDurs = () => { const d = bots().__durs; return d && typeof d === 'object' ? d : {}; };
let db = { users: {}, tokens: {} };
try { db = JSON.parse(fs.readFileSync(DBF, 'utf8')); db.users = db.users || {}; db.tokens = db.tokens || {}; }
catch (e) { if (e.code !== 'ENOENT') { try { fs.copyFileSync(DBF, DBF + '.broken-' + Date.now()); } catch (_) {} console.error('data.json не прочитан, копия сохранена:', e.message); } }
// запись атомарная (tmp + rename): параллельные writeFile раньше могли испортить data.json, и тогда все вылетали из аккаунтов
let st = null;
const flushDb = () => { clearTimeout(st); st = null; try { fs.writeFileSync(DBF + '.tmp', JSON.stringify(db)); fs.renameSync(DBF + '.tmp', DBF); } catch (e) { console.error('save:', e.message); } };
const save = () => { if (!st) st = setTimeout(flushDb, 150); };
['SIGTERM', 'SIGINT'].forEach(sg => process.on(sg, () => { flushDb(); process.exit(0); }));
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
// вход/привязка Telegram: общий код для popup (/api/tg) и редиректа (/api/tg-cb)
function tgUpsert(b, cur) {
  const tid = String(b.id), nm = ([b.first_name, b.last_name].filter(Boolean).join(' ') || b.username || 'Telegram').slice(0, 30);
  let user = Object.values(db.users).find(x => x.tgId === tid);
  if (cur && user && user.id !== cur.id) return { error: 'Этот Telegram уже привязан к другому аккаунту' };
  if (!user) { user = cur || { id: rid(6), name: nm, color: 'p', friends: [] }; db.users[user.id] = user; }
  Object.assign(user, { tgId: tid, tgUser: String(b.username || ''), tgName: nm, tgPhoto: String(b.photo_url || '') });
  if (!user.photo && b.photo_url) user.photo = String(b.photo_url);
  return { user };
}
const pub = u => ({ tg: u.tgId ? { id: u.tgId, username: u.tgUser || '', name: u.tgName || '' } : null, admin: isAdmin(u), id: u.id, name: u.name, bio: u.bio || '', color: u.color || 'p', photo: u.photo || null, until: u.until || null, premium: !!(u.until && u.until > Date.now()), friends: u.friends || [], prefs: u.prefs || null, gallery: u.gallery || [] });

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
  const r = rooms.get(w.room); w.room = null; if (!r || !r.members.delete(w)) return;
  if (!r.members.size) return r.bot ? pushRooms() : instant ? drop(r) : setTimeout(() => !r.members.size && drop(r), 3000); // обрыв связи: 3 c на переподключение
  setTimeout(() => xfer(r), instant ? 0 : 3000);
  toRoom(r, { t: 'mem', list: uniq(r).map(u => ({ name: u.name, color: u.color })) }); pushRooms();
}

function botsChanged() {
  BD = botDurs();
  rooms.forEach(r => r.bot && toRoom(r, { t: 'bot', bot: { start: bStart(r), dur: bDur(r) }, now: Date.now() }));
  pushRooms();
}

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
  let rel; try { rel = path.normalize(decodeURIComponent(url)).replace(/^[\\/]+/, ''); } catch (_) { return false; }
  if (rel.includes('..') || !/^images[\\/]/.test(rel) || !MIME[path.extname(rel).toLowerCase()]) return false;
  const f = path.join(__dirname, rel); let st; try { st = fs.statSync(f); } catch (_) { return false; }
  if (!st.isFile()) return false;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()], 'Content-Length': st.size, 'Cache-Control': 'public, max-age=604800' });
  fs.createReadStream(f).pipe(res); return true;
}

/* ---- HTTP ---- */
const body = req => new Promise(res => { let d = ''; req.on('data', c => (d += c) && d.length > 3e6 && req.destroy()); req.on('end', () => { try { res(JSON.parse(d || '{}')); } catch (_) { res({}); } }); });
const auth = req => db.users[db.tokens[(req.headers.authorization || '').slice(7)]];
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0], out = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }); res.end(JSON.stringify(o)); };
  if (req.method === 'OPTIONS') return out(204, {});
  if (url === '/api/tg-cb') {   // Telegram Login Widget в режиме редиректа (работает на телефоне и в PWA, где popup блокируется)
    const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams), r = tgVerify(q) ? tgUpsert(q, null) : null;
    if (!r || !r.user) { res.writeHead(302, { Location: '/#tgerr' }); return res.end(); }
    const token = rid(24); db.tokens[token] = r.user.id; flushDb();
    res.writeHead(302, { Location: '/#tg=' + token, 'Cache-Control': 'no-store' }); return res.end();
  }
  if (!url.startsWith('/api/')) return (req.method === 'GET' && sendStatic(url, res)) || sendPage(req, res);
  const b = req.method === 'POST' ? await body(req) : {}, u = auth(req);
  const login = user => { const token = rid(24); db.tokens[token] = user.id; flushDb(); out(200, { token, user: pub(user) }); };
  if (url === '/api/config') return out(200, { tgBot: TGT && TGN ? TGN : '' });
  if (url === '/api/register') {
    const em = String(b.email || '').trim().toLowerCase(), nm = String(b.name || '').trim().slice(0, 30);
    if (!em || String(b.password || '').length < 6 || !nm) return out(400, { error: 'Заполните почту, имя и пароль (от 6 символов)' });
    if (Object.values(db.users).some(x => x.email === em)) return out(409, { error: 'Почта уже занята' });
    const salt = rid(8), user = { id: rid(6), email: em, salt, pass: hash(b.password, salt), name: nm, color: 'p', friends: [] }; db.users[user.id] = user; return login(user);
  }
  if (url === '/api/login') {
    const user = Object.values(db.users).find(x => x.email === String(b.email || '').trim().toLowerCase());
    if (!user) return out(404, { error: 'nouser' });
    return hash(String(b.password || ''), user.salt) === user.pass ? login(user) : out(401, { error: 'Неверный пароль' });
  }
  if (url === '/api/tg') {   // вход / регистрация / привязка через Telegram
    if (!TGT) return out(400, { error: 'Telegram не настроен на сервере' });
    if (!tgVerify(b)) return out(401, { error: 'Не удалось подтвердить Telegram' });
    const r = tgUpsert(b, u); if (r.error) return out(409, { error: r.error }); const user = r.user;
    return login(user);
  }
  if (!u) return out(401, { error: 'auth' });
  if (url === '/api/me') return out(200, { user: pub(u) });
  if (url === '/api/profile') {   // частичное обновление: приходят только изменённые поля, остальное не затирается
    if ('name' in b) { const n = String(b.name || '').trim().slice(0, 30); if (n) u.name = n; }
    if ('bio' in b) u.bio = String(b.bio || '').slice(0, 300);
    if ('color' in b && /^[pkobg]$/.test(String(b.color))) u.color = b.color;
    if ('photo' in b) u.photo = typeof b.photo === 'string' && b.photo.length < 600000 && /^(data:image\/|https?:\/\/)/.test(b.photo) ? b.photo : null;
    if ('gallery' in b) u.gallery = Array.isArray(b.gallery) ? b.gallery.filter(g => typeof g === 'string' && g.length < 250000 && /^data:image\//.test(g)).slice(0, 6) : [];
    if (b.prefs && typeof b.prefs === 'object' && !Array.isArray(b.prefs)) { const j = JSON.stringify(b.prefs); if (j.length < 60000) u.prefs = b.prefs; }   // настройки, скрытые строки, вкладки, блок-лист
    flushDb(); return out(200, { user: pub(u) });   // пишем на диск сразу
  }
  if (url === '/api/friends') { u.friends = Array.isArray(b.friends) ? b.friends : []; save(); return out(200, {}); }
  if (url === '/api/premium') { u.until = Date.now() + 30 * 864e5; save(); return out(200, { user: pub(u) }); } // заглушка: без оплаты
  if (url === '/api/bots') {   // ссылки на видео для бот-комнат: { "Название фильма": "https://vk.com/video-1_2?hash=..." }
    if (req.method === 'GET') return out(200, { bots: botLinks(), durs: botDurs() });
    if (!isAdmin(u)) return out(403, { error: 'Только для администратора (ADMIN_EMAILS)' });
    const ok = /^(https?:\/\/)?([\w-]+\.)*(vk\.com|vkvideo\.ru|rutube\.ru|youtube\.com|youtu\.be)\//i, nb = {};
    for (const [k, v] of Object.entries(b.bots || {})) { const x = String(v || '').trim().slice(0, 600); if (x && !ok.test(x)) return out(400, { error: 'Ссылка для «' + k + '» не поддерживается' }); nb[String(k).slice(0, 60)] = x; }
    const nd = {}, src = b.durs === undefined ? botDurs() : b.durs;
    for (const [k, v] of Object.entries(src || {})) { const x = Math.round(+v); if (x >= 1 && x <= 600) nd[String(k).slice(0, 60)] = x; }
    fs.writeFileSync(BOTF, JSON.stringify(Object.assign({}, nb, { __durs: nd }), null, 2)); botsChanged(); return out(200, { bots: nb, durs: nd });
  }
  if (url === '/api/rooms' && req.method === 'GET') return out(200, { list: [...rooms.values()].map(row) });
  if (url === '/api/rooms') {
    const r = { id: rid(5), title: String(b.title || '').trim().slice(0, 60) || 'Комната', poster: +b.poster || 0, media: b.media || null, st: null, log: [], owner: u.id, ownerName: u.name, members: new Map() };
    rooms.set(r.id, r); pushRooms(); setTimeout(() => !r.members.size && drop(r), 15000); // создатель должен зайти в течение 15 c
    return out(200, { room: { id: r.id } });
  }
  out(404, { error: 'not found' });
});

/* ---- WebSocket ---- */
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (w, req) => {
  const u = db.users[db.tokens[new URL(req.url, 'http://x').searchParams.get('token')]];
  if (!u) return w.close(4001);
  w.uid = u.id; w.room = null; socks.add(w);
  send(w, { t: 'rooms', list: [...rooms.values()].map(row) });
  w.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (_) { return; }
    if (m.t === 'join') {
      const r = rooms.get(m.room); if (!r) return send(w, { t: 'err', msg: 'Комната закрыта' });
      if (w.room && w.room !== r.id) leave(w, true);
      w.room = r.id; r.members.set(w, u);
      const ex = r.bot ? { bot: { start: bStart(r), dur: bDur(r) }, st: { a: 'play', t: bPos(r), ts: Date.now() } } : {};   // бот-комната: сразу текущая секунда фильма
      send(w, Object.assign({ t: 'init', room: r.id, t0: m.t0, h: Date.now(), title: r.title, media: r.media, log: r.log.slice(-100), st: r.st, host: r.owner, hn: r.ownerName }, ex));
      toRoom(r, { t: 'mem', list: uniq(r).map(x => ({ name: x.name, color: x.color })) }); pushRooms(); return;
    }
    if (m.t === 'leave') return leave(w, true);
    const r = rooms.get(w.room); if (!r) return;
    if (r.bot && (m.t === 'ctl' || m.t === 'media')) return; // эфир: никто не ставит на паузу и не перематывает
    if ((m.t === 'ctl' || m.t === 'media') && u.id !== r.owner && r.media && (r.media.type === 'vk' || r.media.type === 'rt')) return; // VK/Rutube: управляет только основатель; YouTube и пустые комнаты — как раньше
    if (m.t === 'ctl') { r.st = { a: m.a === 'play' ? 'play' : 'pause', t: +m.p || 0, ts: Date.now() }; toRoom(r, { t: 'ctl', p: r.st }, w); }
    else if (m.t === 'chat') { const text = String(m.text || '').trim().slice(0, 300); if (!text) return; const msg = { id: rid(4), u: u.id, name: u.name, color: u.color, premium: !!(u.until && u.until > Date.now()), text }; r.log.push(msg); if (r.log.length > 200) r.log.shift(); toRoom(r, { t: 'chat', m: msg }); }
    else if (m.t === 'edit') { const x = r.log.find(z => z.id === m.id && z.u === u.id); if (x) { x.text = String(m.text || '').slice(0, 300); toRoom(r, { t: 'edit', id: x.id, text: x.text }); } }
    else if (m.t === 'media') { r.media = m.media || null; r.title = String(m.title || r.title).slice(0, 60); r.st = null; toRoom(r, { t: 'media', media: r.media, title: r.title }, w); pushRooms(); }
  });
  w.on('close', () => { socks.delete(w); leave(w, false); });
});
server.listen(PORT, () => console.log('vibe: http://localhost:' + PORT));
