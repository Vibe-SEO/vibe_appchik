/* Плееры с единым интерфейсом: apply({playing,t}), time(), dur(), destroy().
   Локальные действия пользователя приходят в cb.onLocal({type:'play'|'pause'|'seek', t, playing}). */

export function validMedia(m) {
  if (!m || typeof m !== 'object') return null;
  const s = v => (typeof v === 'string' ? v.slice(0, 200) : '');
  const title = s(m.title);
  if (m.type === 'yt' && /^[\w-]{11}$/.test(m.id)) return { type: 'yt', id: m.id, title, thumb: `https://i.ytimg.com/vi/${m.id}/hqdefault.jpg` };
  if (m.type === 'rt' && /^[0-9a-f]{32}$/i.test(m.id)) return { type: 'rt', id: m.id, p: /^[\w-]{1,64}$/.test(m.p || '') ? m.p : '', title };
  if (m.type === 'vk' && /^-?\d{1,12}$/.test(String(m.oid)) && /^\d{1,12}$/.test(String(m.id)) && /^[0-9a-f]{8,32}$/i.test(m.h || ''))
    return { type: 'vk', oid: String(m.oid), id: String(m.id), h: m.h, title };
  if (m.type === 'nf' && typeof m.q === 'string' && m.q) return { type: 'nf', q: s(m.q), title: title || s(m.q) };
  return null;
}

const loaded = {};
function loadOnce(src, ready, cbName) {
  if (ready()) return Promise.resolve();
  return loaded[src] || (loaded[src] = new Promise((res, rej) => {
    if (cbName) window[cbName] = res;
    const el = document.createElement('script');
    el.src = src; el.async = true;
    if (!cbName) el.onload = res;
    el.onerror = () => { delete loaded[src]; rej(new Error('load ' + src)); };
    document.head.appendChild(el);
  }));
}

function wrap(prim, cb) {
  let mute = 0, prevT = 0, prevAt = Date.now(), dead = false;
  const quiet = () => Date.now() < mute;
  const emit = type => { if (!dead && !quiet()) cb.onLocal({ type, t: prim.time(), playing: prim.playing() }); };
  const iv = setInterval(() => {
    const t = prim.time(), exp = prevT + (prim.playing() ? (Date.now() - prevAt) / 1000 : 0);
    if (!quiet() && Math.abs(t - exp) > 1.6) emit('seek');
    prevT = t; prevAt = Date.now();
  }, 500);
  return {
    emit,
    apply(s) {
      mute = Date.now() + 1200;
      if (Math.abs(prim.time() - s.t) > 0.8) prim.seek(s.t);
      if (s.playing && !prim.playing()) prim.play();
      if (!s.playing && prim.playing()) prim.pause();
      prevT = s.t; prevAt = Date.now();
    },
    time: () => prim.time(),
    dur: () => prim.dur(),
    destroy() { dead = true; clearInterval(iv); try { prim.destroy(); } catch (_) {} },
  };
}

async function yt(box, m, cb) {
  await loadOnce('https://www.youtube.com/iframe_api', () => window.YT && window.YT.Player, 'onYouTubeIframeAPIReady');
  const el = document.createElement('div'); el.id = 'pl'; box.replaceChildren(el);
  return new Promise(res => {
    let ready = false, g;
    const p = new window.YT.Player(el, {
      videoId: m.id, width: '100%', height: '100%',
      playerVars: { playsinline: 1, rel: 0, origin: location.origin },
      events: {
        onReady: () => { ready = true; res(g); },
        onStateChange: e => { if (e.data === 1) g.emit('play'); else if (e.data === 2) g.emit('pause'); },
        onError: () => cb.onError('Это видео нельзя встроить — выберите другое'),
      },
    });
    g = wrap({
      play: () => p.playVideo(), pause: () => p.pauseVideo(), seek: t => p.seekTo(t, true),
      time: () => (ready && p.getCurrentTime()) || 0, dur: () => (ready && p.getDuration()) || 0,
      playing: () => ready && p.getPlayerState() === 1, destroy: () => p.destroy(),
    }, cb);
  });
}

function iframe(box, src) {
  const f = document.createElement('iframe');
  f.src = src; f.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write'; f.allowFullscreen = true;
  box.replaceChildren(f);
  return f;
}

// Rutube: postMessage API
function rt(box, m, cb) {
  const f = iframe(box, 'https://rutube.ru/play/embed/' + m.id + (m.p ? '/?p=' + encodeURIComponent(m.p) : ''));
  let t = 0, d = 0, pl = false, g;
  const post = (type, data = {}) => f.contentWindow && f.contentWindow.postMessage(JSON.stringify({ type, data }), '*');
  const onMsg = e => {
    if (e.source !== f.contentWindow) return;
    let j; try { j = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (_) { return; }
    if (!j || !j.type) return;
    if (j.type === 'player:currentTime') t = +(j.data && j.data.time) || 0;
    else if (j.type === 'player:durationChange') d = +(j.data && j.data.duration) || d;
    else if (j.type === 'player:changeState') { const s = j.data && j.data.state === 'playing'; if (s !== pl) { pl = s; g.emit(s ? 'play' : 'pause'); } }
  };
  window.addEventListener('message', onMsg);
  g = wrap({
    play: () => post('player:play'), pause: () => post('player:pause'), seek: x => { t = x; post('player:setCurrentTime', { time: x }); },
    time: () => t, dur: () => d, playing: () => pl, destroy: () => { window.removeEventListener('message', onMsg); box.replaceChildren(); },
  }, cb);
  return g;
}

// VK: VK.VideoPlayer JS API (нужен js_api=1 и корректный hash)
async function vk(box, m, cb) {
  const f = iframe(box, `https://vk.com/video_ext.php?oid=${encodeURIComponent(m.oid)}&id=${encodeURIComponent(m.id)}&hash=${encodeURIComponent(m.h)}&hd=2&js_api=1`);
  try {
    await loadOnce('https://vk.com/js/api/videoplayer.js', () => window.VK && window.VK.VideoPlayer);
    const p = window.VK.VideoPlayer(f);
    let t = 0, d = 0, pl = false, g;
    const num = x => (typeof x === 'number' ? x : +(x && (x.time ?? x.currentTime)) || 0);
    p.on('started', () => { pl = true; g.emit('play'); });
    p.on('resumed', () => { pl = true; g.emit('play'); });
    p.on('paused', () => { pl = false; g.emit('pause'); });
    p.on('timeupdate', x => { t = num(x); });
    p.on('inited', () => { try { d = p.getDuration() || 0; } catch (_) {} });
    g = wrap({
      play: () => p.play(), pause: () => p.pause(), seek: x => { t = x; p.seek(x); },
      time: () => t, dur: () => d, playing: () => pl, destroy: () => box.replaceChildren(),
    }, cb);
    return g;
  } catch (_) {
    cb.onError('Синхронизация VK недоступна — видео открыто без общего управления');
    return null;
  }
}

export async function createPlayer(box, m, cb) {
  try {
    if (m.type === 'yt') return await yt(box, m, cb);
    if (m.type === 'rt') return rt(box, m, cb);
    if (m.type === 'vk') return await vk(box, m, cb);
  } catch (_) { cb.onError('Не удалось запустить плеер'); }
  return null;
}
