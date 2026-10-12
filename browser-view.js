'use strict';
/**
 * Встроенный браузер (как у Rave): настоящий VK Видео / YouTube / Rutube внутри окна приложения.
 * Страница сервиса показывается в WebContentsView под верхней панелью vibe (#nbrowse в index.html).
 * Кнопка «Смотреть вместе» берёт ссылку текущего видео и отдаёт её в index.html -> комната запускается.
 * Требуется Electron >= 30.
 */
const { WebContentsView, ipcMain, session, shell, app } = require('electron');

const TOP = 64;                         // высота панели #nbrowse в index.html (px)
const PARTITION = 'persist:vibe-browser'; // отдельное хранилище: вход в VK/YouTube сохраняется
const HOMES = { vk: 'https://vkvideo.ru', yt: 'https://www.youtube.com', rt: 'https://rutube.ru' };

// куда браузеру можно ходить (остальное открывается в системном браузере)
const ALLOWED = [
  /(^|\.)vk\.com$/, /(^|\.)vk\.ru$/, /(^|\.)vkvideo\.ru$/, /(^|\.)ok\.ru$/, /(^|\.)mail\.ru$/,
  /(^|\.)youtube\.com$/, /^youtu\.be$/, /(^|\.)google\.com$/, /(^|\.)gstatic\.com$/, /(^|\.)googlevideo\.com$/,
  /(^|\.)rutube\.ru$/,
];
const hostOk = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && ALLOWED.some(r => r.test(x.hostname)); } catch { return false; } };

function classify(u) {
  try {
    const x = new URL(u), h = x.hostname.replace(/^(www|m)\./, '');
    if (/(^|\.)youtube\.com$/.test(h)) {
      const id = x.pathname === '/watch' ? x.searchParams.get('v') : (x.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/) || [])[1];
      return { platform: 'yt', video: !!(id && /^[\w-]{11}$/.test(id)), id };
    }
    if (h === 'youtu.be') { const id = x.pathname.slice(1, 12); return { platform: 'yt', video: /^[\w-]{11}$/.test(id), id }; }
    if (/(^|\.)(vk\.com|vk\.ru|vkvideo\.ru)$/.test(h)) return { platform: 'vk', video: /video-?\d+_\d+/.test(decodeURIComponent(x.pathname + x.search)) };
    if (h === 'rutube.ru') return { platform: 'rt', video: /^\/video\/[0-9a-f]{32}/i.test(x.pathname) };
  } catch {}
  return { platform: null, video: false };
}

// ссылка VK в виде, который понимает index.html: vk.com/video<oid>_<id>?hash=<hash>
function vkLink(s) {
  if (!s) return '';
  try {
    const x = new URL(s);
    let oid, id, hash = x.searchParams.get('hash') || '';
    if (/video_ext\.php/.test(x.pathname)) { oid = x.searchParams.get('oid'); id = x.searchParams.get('id'); }
    else { const m = decodeURIComponent(x.pathname + x.search).match(/video(-?\d+)_(\d+)/); if (m) { oid = m[1]; id = m[2]; } }
    if (!oid || !id) return '';
    return `https://vk.com/video${oid}_${id}` + (hash ? `?hash=${hash}` : '');
  } catch { return ''; }
}

function setupBrowser(win) {
  let view = null, htmlFs = false;
  const send = (ch, d) => { if (!win.isDestroyed()) win.webContents.send(ch, d); };
  const mine = e => e.sender === win.webContents;

  const ses = session.fromPartition(PARTITION);
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'fullscreen' || perm === 'clipboard-sanitized-write'));

  const layout = () => {
    if (!view) return;
    const [w, h] = win.getContentSize();
    view.setBounds(htmlFs ? { x: 0, y: 0, width: w, height: h } : { x: 0, y: TOP, width: w, height: Math.max(0, h - TOP) });
  };
  const state = (extra = {}) => {
    if (!view) return send('vb:state', { open: false });
    const wc = view.webContents, url = wc.getURL(), c = classify(url);
    send('vb:state', Object.assign({ open: true, url, title: wc.getTitle(), canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward(), platform: c.platform, video: c.video, loading: wc.isLoading() }, extra));
  };

  function open(url) {
    if (!hostOk(url)) return;
    if (view) { view.webContents.loadURL(url); return; }
    view = new WebContentsView({ webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const wc = view.webContents;
    // без «Electron/…» в user-agent, иначе YouTube/VK могут отдавать урезанную версию
    wc.setUserAgent((app.userAgentFallback || wc.getUserAgent()).replace(/\s(Electron|vibe[-\w]*)\/[\d.]+/gi, '').replace(' ' + app.getName() + '/' + app.getVersion(), ''));
    win.contentView.addChildView(view);
    layout();
    wc.setWindowOpenHandler(({ url: u }) => { if (hostOk(u)) wc.loadURL(u); else if (/^https?:/.test(u)) shell.openExternal(u); return { action: 'deny' }; });
    const guard = (e, u) => { if (!hostOk(u)) { e.preventDefault(); if (/^https?:/.test(u)) shell.openExternal(u); } };
    wc.on('will-navigate', guard); wc.on('will-redirect', guard);
    ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading'].forEach(ev => wc.on(ev, () => state()));
    wc.on('enter-html-full-screen', () => { htmlFs = true; layout(); });
    wc.on('leave-html-full-screen', () => { htmlFs = false; layout(); });
    wc.loadURL(url);
    state();
  }

  function close() {
    if (!view) return;
    try { win.contentView.removeChildView(view); view.webContents.close(); } catch {}
    view = null; htmlFs = false; state();
  }

  async function pick() {
    if (!view) return;
    const wc = view.webContents, url = wc.getURL(), c = classify(url);
    if (!c.video) return send('vb:toast', 'Откройте страницу с видео');
    let out = url;
    if (c.platform === 'yt') out = `https://www.youtube.com/watch?v=${c.id}`;
    if (c.platform === 'vk') {
      let og = '';
      try { og = await wc.executeJavaScript(`(()=>{const m=document.querySelector('meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"]');return m?m.content:''})()`); } catch {}
      out = vkLink(og) || vkLink(url) || url;
    }
    const title = (wc.getTitle() || '').replace(/\s*[-—|]\s*(YouTube|VK Видео|VK Video|Rutube).*$/i, '').trim();
    close();
    send('vb:pick', { url: out, title });
  }

  ipcMain.on('vb:open', (e, payload) => {
    if (!mine(e)) return;
    let p = {}; try { p = typeof payload === 'string' ? JSON.parse(payload) : (payload || {}); } catch {}
    open(p.url && hostOk(p.url) ? p.url : (HOMES[p.platform] || HOMES.vk));
  });
  ipcMain.on('vb:close', e => { if (mine(e)) close(); });
  ipcMain.on('vb:back', e => { if (mine(e) && view && view.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack(); });
  ipcMain.on('vb:forward', e => { if (mine(e) && view && view.webContents.navigationHistory.canGoForward()) view.webContents.navigationHistory.goForward(); });
  ipcMain.on('vb:reload', e => { if (mine(e) && view) view.webContents.reload(); });
  ipcMain.on('vb:nav', (e, url) => { if (mine(e) && view && hostOk(url)) view.webContents.loadURL(url); });
  ipcMain.on('vb:pick', e => { if (mine(e)) pick(); });

  win.on('resize', layout);
  win.on('enter-full-screen', layout); win.on('leave-full-screen', layout);
  win.on('closed', () => { view = null; });
  return { open, close };
}

module.exports = { setupBrowser };
