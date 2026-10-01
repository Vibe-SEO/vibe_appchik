// npm i ws && node server.js   (index.html лежит рядом)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws'), zlib = require('zlib');
const PORT = process.env.PORT || 3000, DIR = process.env.DATA_DIR || __dirname, DBF = path.join(DIR, 'data.json'); // DATA_DIR — папка на постоянном диске хостинга, иначе вход слетает при каждом перезапуске
/* Настройки: переменные окружения ИЛИ файл config.json рядом с server.js:
   { "tgToken": "123456:AA...(токен из BotFather)", "tgName": "my_vibe_bot", "admins": ["you@mail.com"] } */
const cfg = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch (_) { return {}; } })();
const TGT = process.env.TG_BOT_TOKEN || cfg.tgToken || '', TGN = String(process.env.TG_BOT_NAME || cfg.tgName || '').replace(/^@/, '');
const ADMIN = String(process.env.ADMIN_EMAILS || [].concat(cfg.admins || []).join(',')).toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
const FRONT = String(process.env.FRONT_URL || cfg.frontUrl || '').replace(/\/$/, '');   // адрес сайта на Netlify, например https://vibe.netlify.app (куда вернуть после входа через Telegram)
const STARS = Math.max(1, +(process.env.PREMIUM_STARS || cfg.premiumStars || 100)), TGA = String(process.env.TG_ADMIN_IDS || [].concat(cfg.adminTgIds || []).join(',')).split(',').map(x => x.trim()).filter(Boolean);   // цена в Telegram Stars; числовые Telegram-id админов (необязательно)
const TZ = process.env.STATS_TZ || 'Europe/Moscow';
const BOTF = path.join(DIR, 'bots.json'), bots = () => { try { return JSON.parse(fs.readFileSync(BOTF, 'utf8')); } catch (_) { return {}; } };
// bots.json: { "Название": "ссылка", "__durs": { "Название": минуты } }
const botLinks = () => { const o = bots(); delete o.__durs; return o; }, botDurs = () => { const d = bots().__durs; return d && typeof d === 'object' ? d : {}; };
let db = { users: {}, tokens: {}, payments: {}, stats: { days: {} } };
try { db = JSON.parse(fs.readFileSync(DBF, 'utf8')); db.users = db.users || {}; db.tokens = db.tokens || {}; db.payments = db.payments || {}; db.stats = db.stats || {}; db.stats.days = db.stats.days || {}; }
catch (e) { if (e.code !== 'ENOENT') { try { fs.copyFileSync(DBF, DBF + '.broken-' + Date.now()); } catch (_) {} console.error('data.json не прочитан, копия сохранена:', e.message); } }
// запись атомарная (tmp + rename): параллельные writeFile раньше могли испортить data.json, и тогда все вылетали из аккаунтов
let st = null;
const flushDb = () => { clearTimeout(st); st = null; try { fs.writeFileSync(DBF + '.tmp', JSON.stringify(db)); fs.renameSync(DBF + '.tmp', DBF); } catch (e) { console.error('save:', e.message); } schedRemote(); };
const save = () => { if (!st) st = setTimeout(flushDb, 150); };

/* ---- Supabase: постоянное хранилище (переживает перезапуски и деплои Render) ----
   Таблица vibe_kv(k text primary key, v jsonb): u:<id> — пользователь, t:<токен> — вход, p:<id платежа>, s:<день> — статистика, bots — ссылки бот-комнат.
   Пишутся только изменившиеся записи. data.json остаётся запасной копией. */
const SBU = String(process.env.SUPABASE_URL || cfg.supabaseUrl || '').replace(/\/$/, ''), SBK = String(process.env.SUPABASE_KEY || cfg.supabaseKey || '').trim(), REMOTE = !!(SBU && SBK);
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
  try { add('bots', { txt: fs.readFileSync(BOTF, 'utf8') }); } catch (_) {}
  return rows;
}
async function doPush() {
  if (!REMOTE) return;
  try {
    const rows = remoteRows();
    for (let i = 0; i < rows.length; i += 25) {
      const part = rows.slice(i, i + 25), at = new Date().toISOString();
      await sbReq('?on_conflict=k', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(part.map(x => ({ k: x.k, v: x.v, updated_at: at }))) });
      part.forEach(x => sig.set(x.k, x.h));
    }
    rfail = false;
  } catch (e) { rfail = true; console.error('supabase save:', e.message); }
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
      const nd = { users: {}, tokens: {}, payments: {}, stats: { days: {} } };
      for (const { k, v } of rows) {
        if (k.startsWith('u:')) nd.users[k.slice(2)] = v; else if (k.startsWith('t:')) nd.tokens[k.slice(2)] = v;
        else if (k.startsWith('p:')) nd.payments[k.slice(2)] = v; else if (k.startsWith('s:')) nd.stats.days[k.slice(2)] = v;
        else if (k === 'bots' && v && typeof v.txt === 'string') { try { fs.writeFileSync(BOTF + '.tmp', v.txt); fs.renameSync(BOTF + '.tmp', BOTF); } catch (_) {} }
      }
      db = nd; BD = botDurs(); remoteRows().forEach(x => sig.set(x.k, x.h));
      console.log('Supabase: загружено аккаунтов — ' + Object.keys(db.users).length); return;
    } catch (e) { console.error('supabase load (' + a + '/5):', e.message); if (a >= 5) throw e; await new Promise(z => setTimeout(z, 3000)); }
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

/* ---- Telegram Bot API: оплата Premium (Stars), счётчик посетителей, команды админа ---- */
const tgApi = async (method, data) => {
  if (!TGT) return null;
  try { const r = await fetch('https://api.telegram.org/bot' + TGT + '/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) }); return await r.json(); }
  catch (e) { console.error('tg ' + method + ':', e.message); return null; }
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

/* ---- HTTP ---- */
const body = req => new Promise(res => { let d = ''; req.on('data', c => (d += c) && d.length > 3e6 && req.destroy()); req.on('end', () => { try { res(JSON.parse(d || '{}')); } catch (_) { res({}); } }); });
const auth = req => db.users[db.tokens[(req.headers.authorization || '').slice(7)]];
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0], out = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }); res.end(JSON.stringify(o)); };
  if (req.method === 'OPTIONS') return out(204, {});
  if (url === '/api/tg-cb') {   // Telegram Login Widget в режиме редиректа (работает на телефоне и в PWA, где popup блокируется)
    const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams), r = tgVerify(q) ? tgUpsert(q, null) : null;
    if (!r || !r.user) { res.writeHead(302, { Location: FRONT + '/#tgerr' }); return res.end(); }
    const token = rid(24); db.tokens[token] = r.user.id; flushDb();
    res.writeHead(302, { Location: FRONT + '/#tg=' + token, 'Cache-Control': 'no-store' }); return res.end();
  }
  if (!url.startsWith('/api/')) return (req.method === 'GET' && sendStatic(url, res)) || sendPage(req, res);
  const b = req.method === 'POST' ? await body(req) : {}, u = auth(req);
  const login = user => { const token = rid(24); db.tokens[token] = user.id; flushDb(); out(200, { token, user: pub(user) }); };
  if (url === '/api/config') return out(200, { tgBot: TGT && TGN ? TGN : '', pay: !!TGT, price: STARS + ' ⭐' });
  if (url === '/api/hit') { hit(b.vid); return out(200, {}); }   // счётчик посетителей (без авторизации)
  if (url === '/api/register') {
    const em = String(b.email || '').trim().toLowerCase(), nm = String(b.name || '').trim().slice(0, 30);
    if (!em || String(b.password || '').length < 6 || !nm) return out(400, { error: 'Заполните почту, имя и пароль (от 6 символов)' });
    if (Object.values(db.users).some(x => x.email === em)) return out(409, { error: 'Почта уже занята' });
    const salt = rid(8), user = { id: rid(6), email: em, salt, pass: hash(b.password, salt), name: nm, color: 'p', friends: [], created: Date.now() }; db.users[user.id] = user; return login(user);
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
    const ok = /^(https?:\/\/)?([\w-]+\.)*(vk\.com|vkvideo\.ru|rutube\.ru|youtube\.com|youtu\.be)\//i, nb = {};
    for (const [k, v] of Object.entries(b.bots || {})) { const x = String(v || '').trim().slice(0, 600); if (x && !ok.test(x)) return out(400, { error: 'Ссылка для «' + k + '» не поддерживается' }); nb[String(k).slice(0, 60)] = x; }
    const nd = {}, src = b.durs === undefined ? botDurs() : b.durs;
    for (const [k, v] of Object.entries(src || {})) { const x = Math.round(+v); if (x >= 1 && x <= 600) nd[String(k).slice(0, 60)] = x; }
    fs.writeFileSync(BOTF + '.tmp', JSON.stringify(Object.assign({}, nb, { __durs: nd }), null, 2)); fs.renameSync(BOTF + '.tmp', BOTF); schedRemote(); botsChanged(); return out(200, { bots: nb, durs: nd });
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
(async () => {
  if (REMOTE) { try { await loadRemote(); } catch (e) { console.error('Supabase недоступен — остановка, чтобы не потерять данные:', e.message); process.exit(1); } schedRemote(); }
  else console.warn('ВНИМАНИЕ: SUPABASE_URL/SUPABASE_KEY не заданы — данные только в data.json (на бесплатном Render он стирается)');
  server.listen(PORT, () => console.log('vibe: http://localhost:' + PORT + (TGT ? ' · бот включён' : ' · бот НЕ настроен (TG_BOT_TOKEN)') + (REMOTE ? ' · Supabase' : '')));
  if (TGT) tgPoll();
})();
