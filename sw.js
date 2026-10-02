/* vibe — service worker: быстрый запуск и работа оболочки без сети.
   /api, WebSocket, видео и чужие плееры НЕ кэшируются. */
const V = 'vibe-v1';
const SHELL = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const CDN = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.tailwindcss.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || r.headers.has('range')) return;
  const u = new URL(r.url);
  if (u.pathname.startsWith('/api') || u.pathname.startsWith('/ws')) return;
  const same = u.origin === location.origin;
  if (!same && !CDN.includes(u.hostname)) return;

  // страница: сначала сеть (всегда свежая версия), без сети — из кэша
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then(res => { const cp = res.clone(); caches.open(V).then(c => c.put('./', cp)); return res; })
      .catch(() => caches.match('./').then(x => x || Response.error())));
    return;
  }
  // остальное: мгновенно из кэша и тихо обновляем
  e.respondWith(caches.match(r).then(hit => {
    const net = fetch(r).then(res => { if (res && (res.ok || res.type === 'opaque')) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); } return res; }).catch(() => hit);
    return hit || net;
  }));
});
