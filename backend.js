import { createClient } from '@supabase/supabase-js';

const URL_ = import.meta.env.VITE_SUPABASE_URL, KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!URL_ || !KEY) console.error('Не заданы VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (.env)');

export const sb = createClient(URL_ || 'http://localhost', KEY || 'anon', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 10 } },
});

const ok = ({ data, error }) => { if (error) throw error; return data; };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = v => { if (!UUID.test(v)) throw new Error('bad_id'); return v; };

/* ---------- серверное время (для синхронизации) ---------- */
let off = 0;
export const now = () => Date.now() + off;
export async function syncClock() {
  try {
    const t0 = Date.now(), s = ok(await sb.rpc('server_time')), t1 = Date.now();
    off = new Date(s).getTime() - (t0 + t1) / 2;
  } catch (_) { off = 0; }
}

/* ---------- авторизация ---------- */
export const auth = {
  session: async () => (await sb.auth.getSession()).data.session,
  signUp: async (email, password, name) => ok(await sb.auth.signUp({ email, password, options: { data: { name } } })),
  signIn: async (email, password) => ok(await sb.auth.signInWithPassword({ email, password })),
  // Telegram: кастомный OIDC-провайдер Supabase (Auth → Providers → Custom). Пока не настроен — вернёт error.
  telegram: () => sb.auth.signInWithOAuth({
    provider: import.meta.env.VITE_TG_PROVIDER || 'custom:telegram',
    options: { redirectTo: location.origin + location.pathname + location.hash },
  }),
  out: () => sb.auth.signOut(),
  on: cb => sb.auth.onAuthStateChange((ev, s) => setTimeout(() => cb(ev, s), 0)).data.subscription,
};

/* ---------- профили ---------- */
const cache = new Map();
export const isPrem = p => !!(p && p.premium_until && new Date(p.premium_until) > new Date());
export const profile = {
  cache,
  get: async id => { const p = ok(await sb.from('profiles').select('*').eq('id', uuid(id)).single()); cache.set(id, p); return p; },
  many: async ids => {
    const miss = [...new Set(ids)].filter(i => i && !cache.has(i) && UUID.test(i));
    if (miss.length) ok(await sb.from('profiles').select('id,handle,name,color,avatar,premium_until').in('id', miss)).forEach(p => cache.set(p.id, p));
    return new Map(ids.map(i => [i, cache.get(i)]));
  },
  update: async (id, patch) => { const p = ok(await sb.from('profiles').update(patch).eq('id', id).select('*').single()); cache.set(id, p); return p; },
  buy: async () => ok(await sb.rpc('buy_premium')),
  watch: (sec, size) => sb.rpc('add_watch', { p_seconds: sec, p_room_size: size }),
};

/* ---------- комнаты ---------- */
export const roomsApi = {
  list: async () => ok(await sb.from('rooms').select('*').order('created_at', { ascending: false }).limit(100)),
  one: async id => ok(await sb.from('rooms').select('*').eq('id', uuid(id)).single()),
  create: async r => ok(await sb.from('rooms').insert(r).select('*').single()),
  setMedia: async (id, media) => ok(await sb.from('rooms').update({ media, state: { playing: false, t: 0, ts: now() } }).eq('id', uuid(id)).select('*').single()),
  saveState: async (id, state) => ok(await sb.rpc('set_room_state', { p_room: uuid(id), p_state: state })),
  byCode: async code => (ok(await sb.rpc('get_room_by_code', { p_code: String(code).slice(0, 16) })) || [])[0] || null,
  watch: cb => {
    const ch = sb.channel('db-rooms').on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, cb).subscribe();
    return () => sb.removeChannel(ch);
  },
};

/* ---------- онлайн: один общий канал присутствия ---------- */
export function joinLobby(me, onSync) {
  const ch = sb.channel('lobby', { config: { presence: { key: me.id } } });
  let info = { id: me.id, name: me.name, color: me.color, room: null };
  ch.on('presence', { event: 'sync' }, () => onSync(Object.values(ch.presenceState()).map(a => a[0]).filter(Boolean)));
  ch.subscribe(st => { if (st === 'SUBSCRIBED') ch.track(info); });
  return {
    setRoom: room => { info = { ...info, room }; return ch.track(info); },
    setInfo: p => { info = { ...info, ...p }; return ch.track(info); },
    stop: () => sb.removeChannel(ch),
  };
}

/* ---------- синхронизация плеера (broadcast) ---------- */
export function joinSync(roomId, h) {
  const ch = sb.channel('sync:' + roomId, { config: { broadcast: { self: false } } });
  ch.on('broadcast', { event: 'state' }, ({ payload }) => h.onState(payload))
    .on('broadcast', { event: 'media' }, ({ payload }) => h.onMedia(payload))
    .on('broadcast', { event: 'hello' }, () => h.onHello());
  ch.subscribe(st => { if (st === 'SUBSCRIBED' && h.onReady) h.onReady(); });
  const send = (event, payload = {}) => ch.send({ type: 'broadcast', event, payload });
  return { state: s => send('state', s), media: p => send('media', p), hello: () => send('hello'), stop: () => sb.removeChannel(ch) };
}

/* ---------- чат ---------- */
export const chat = {
  history: async roomId => ok(await sb.from('messages').select('id,user_id,body,edited,created_at').eq('room_id', uuid(roomId)).order('id', { ascending: false }).limit(100)).reverse(),
  send: async (roomId, body) => ok(await sb.from('messages').insert({ room_id: roomId, body }).select('id,user_id,body,edited,created_at').single()),
  edit: async (id, body) => ok(await sb.from('messages').update({ body }).eq('id', id).select('id,body').single()),
  watch: (roomId, on) => {
    const f = { schema: 'public', table: 'messages', filter: `room_id=eq.${uuid(roomId)}` };
    const ch = sb.channel('chat:' + roomId)
      .on('postgres_changes', { ...f, event: 'INSERT' }, p => on('ins', p.new))
      .on('postgres_changes', { ...f, event: 'UPDATE' }, p => on('upd', p.new))
      .subscribe();
    return () => sb.removeChannel(ch);
  },
};

/* ---------- друзья ---------- */
export const friendsApi = {
  load: async uid => {
    const [l, b, r] = await Promise.all([
      sb.from('friend_links').select('a,b,status'),
      sb.from('blocks').select('blocked_id'),
      sb.from('recents').select('other_id,room_title,at').order('at', { ascending: false }).limit(30),
    ]);
    const links = ok(l), out = { friends: [], incoming: [], outgoing: [], blocked: ok(b).map(x => x.blocked_id), recents: ok(r) };
    links.forEach(x => {
      const other = x.a === uid ? x.b : x.a;
      if (x.status === 'accepted') out.friends.push(other);
      else if (x.b === uid) out.incoming.push(other);
      else out.outgoing.push(other);
    });
    return out;
  },
  search: async (q, uid) => {
    q = q.replace(/[^\p{L}\p{N}_. -]/gu, '').trim().slice(0, 30);
    if (!q) return [];
    const rows = ok(await sb.from('profiles').select('id,handle,name,color,avatar,premium_until').or(`name.ilike.%${q}%,handle.ilike.%${q}%`).neq('id', uid).limit(20));
    rows.forEach(p => cache.set(p.id, p));
    return rows;
  },
  suggest: async uid => {
    const rows = ok(await sb.from('profiles').select('id,handle,name,color,avatar,premium_until').neq('id', uid).order('created_at', { ascending: false }).limit(12));
    rows.forEach(p => cache.set(p.id, p));
    return rows;
  },
  add: async (uid, other) => ok(await sb.from('friend_links').insert({ a: uid, b: uuid(other) })),
  accept: async (uid, other) => ok(await sb.from('friend_links').update({ status: 'accepted' }).eq('a', uuid(other)).eq('b', uid)),
  remove: async (uid, o) => { uuid(o); return ok(await sb.from('friend_links').delete().or(`and(a.eq.${uid},b.eq.${o}),and(a.eq.${o},b.eq.${uid})`)); },
  unblock: async (uid, other) => ok(await sb.from('blocks').delete().eq('user_id', uid).eq('blocked_id', uuid(other))),
  touch: async (uid, other, title) => ok(await sb.from('recents').upsert({ user_id: uid, other_id: other, room_title: title, at: new Date().toISOString() }, { onConflict: 'user_id,other_id' })),
  watch: cb => {
    const ch = sb.channel('db-friends').on('postgres_changes', { event: '*', schema: 'public', table: 'friend_links' }, cb).subscribe();
    return () => sb.removeChannel(ch);
  },
};

/* ---------- приглашения в комнату ---------- */
export const invites = {
  listen: (uid, on) => {
    const ch = sb.channel('user:' + uid).on('broadcast', { event: 'invite' }, ({ payload }) => on(payload)).subscribe();
    return () => sb.removeChannel(ch);
  },
  send: async (toId, payload) => {
    const ch = sb.channel('user:' + uuid(toId));
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), 5000); ch.subscribe(s => { if (s === 'SUBSCRIBED') { clearTimeout(t); res(); } }); });
    await ch.send({ type: 'broadcast', event: 'invite', payload });
    sb.removeChannel(ch);
  },
};
