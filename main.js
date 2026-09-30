import { sb, now, syncClock, auth, profile, isPrem, roomsApi, joinLobby, joinSync, chat, friendsApi, invites } from './backend.js';
import { createPlayer, validMedia } from './player.js';
import './style.css';

    const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
    const esc = t => t.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const C = { p: 'bg-[#8b3dff]', k: 'bg-[#e6338a]', o: 'bg-[#f0851c]', b: 'bg-[#2f8bff]', g: 'bg-[#12b981]' };
    const BTN1 = 'flex h-[54px] w-full items-center justify-center rounded-full bg-gradient-to-r from-[#b06bff] via-[#8a5cff] to-[#6f5cff] font-medium shadow-[0_10px_34px_rgba(130,80,255,.5)] transition hover:brightness-110 active:scale-[.98]';
    const BTN2 = 'flex h-[54px] w-full items-center justify-center rounded-full border border-[rgba(150,120,255,.35)] bg-white/5 font-medium transition hover:bg-white/10 active:scale-[.98]';
    const INP = 'h-[52px] w-full rounded-full border border-[rgba(150,120,255,.28)] bg-[rgba(8,5,20,.55)] px-5 text-base text-white outline-none placeholder:text-hint focus:border-violet-vibe';
    const PLAY = 'relative grid h-11 w-11 place-items-center rounded-full border-2 border-white/80 bg-white/15 backdrop-blur transition group-hover:scale-110 lg:h-14 lg:w-14';
    const PI = '<svg viewBox="0 0 24 24" class="ml-0.5 h-5 w-5 fill-white lg:h-6 lg:w-6"><path d="M9 6.5v11l9-5.5z"/></svg>';

    const pool = [
      'bg-gradient-to-br from-[#6a2bd6] via-[#2a1160] to-[#140a32]',
      'bg-[radial-gradient(40%_60%_at_55%_45%,rgba(230,60,50,.85),transparent_70%),linear-gradient(135deg,#1b2a4d,#5a6a86_45%,#2a1e2e)]',
      'bg-[radial-gradient(45%_60%_at_30%_40%,rgba(224,29,43,.7),transparent_70%),linear-gradient(135deg,#d9d3cd,#5b5252_50%,#1c1818)]',
      'bg-gradient-to-br from-[#0b3a4a] via-[#0a1a26] to-[#060b12]',
      'bg-gradient-to-br from-[#e6338a] via-[#5a1a7a] to-[#1a0f40]',
    ];
    let rooms = [], uid = null, pfl = {}, curRoom = null, S_ = null, lobby = null, lobbyUsers = [];
    let friends = [];
    let me = 'Гость'; const invited = new Set();

    const av = (u, i) => `<b class="grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-[#150d33] text-[11px] font-semibold text-white ${C[u[1]]} ${i ? '-ml-1' : ''}">${u[0]}</b>`;

    function render(anim) {
      const q = $('#q').value.trim().toLowerCase();
      const items = rooms.map((r, i) => [r, i]).filter(([r]) => r.title.toLowerCase().includes(q));
      $('#list').innerHTML = items.length ? items.map(([r, i], k) => `
        <li class="${anim ? 'rise' : ''} lg:h-full" style="--i:${k + 4}">
          <a href="#" data-room="${r.id}" class="group relative flex h-24 items-stretch overflow-hidden rounded-[22px] border border-[rgba(150,120,255,.28)]
                bg-gradient-to-r from-[rgba(38,24,82,.7)] to-[rgba(18,12,42,.85)] shadow-[0_6px_20px_rgba(0,0,0,.3),inset_0_0_20px_rgba(120,80,255,.08)]
                transition duration-200 active:scale-[.98] active:border-[rgba(190,150,255,.65)]
                lg:h-full lg:flex-col lg:rounded-[26px] lg:hover:-translate-y-1 lg:hover:border-[rgba(190,150,255,.65)] lg:hover:shadow-[0_18px_50px_rgba(140,80,255,.35)]">
            <div class="relative grid w-[132px] shrink-0 place-items-center overflow-hidden lg:aspect-video lg:w-full">
              <i class="absolute inset-0 ${r.poster} transition-transform duration-500 lg:group-hover:scale-110"></i>${r.thumb ? `<img src="${r.thumb}" alt="" class="absolute inset-0 h-full w-full object-cover transition-transform duration-500 lg:group-hover:scale-110" onerror="this.remove()">` : ''}
              <span class="${PLAY}">${PI}</span>
              ${r.progress
                ? '<em class="absolute left-3 top-3 hidden items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-semibold not-italic backdrop-blur lg:flex"><b class="relative h-2 w-2 rounded-full bg-[#ff2d7a]"><b class="absolute inset-0 rounded-full bg-[#ff2d7a]" style="animation:ping2 1.6s ease-out infinite"></b></b>Идёт сейчас</em>'
                : '<em class="absolute left-3 top-3 hidden items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-semibold not-italic backdrop-blur lg:flex"><b class="h-2 w-2 rounded-full bg-white/50"></b>Ожидание</em>'}
            </div>
            <div class="flex min-w-0 flex-1 flex-col justify-center gap-2 py-3 pl-4 pr-9 lg:justify-between lg:gap-4 lg:p-5">
              <h3 class="truncate text-sm font-semibold lg:text-lg">${esc(r.title)}</h3>
              <div class="flex h-6 items-center justify-between gap-3 lg:h-9">
                <div class="flex min-w-0 items-center overflow-hidden">${r.users.map(av).join('')}${r.more ? `<i class="ml-2 shrink-0 whitespace-nowrap rounded-[10px] bg-[#ff2d7a] px-1.5 py-0.5 text-[10px] font-bold not-italic text-white">+${r.more}</i>` : ''}</div>
                <span class="hidden h-9 w-9 shrink-0 place-items-center rounded-full border border-[rgba(150,120,255,.35)] bg-white/5 text-[#c9b8ff] transition duration-200 lg:grid group-hover:translate-x-0.5 group-hover:border-transparent group-hover:bg-gradient-to-br group-hover:from-[#b06bff] group-hover:to-[#7c4dff] group-hover:text-white"><svg viewBox="0 0 24 24" class="ico !h-[18px] !w-[18px]"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
              </div>
              <div class="h-[3px] w-full overflow-hidden rounded bg-white/15"><span class="block h-full rounded bg-white" style="width:${r.progress}%"></span></div>
            </div>
            <svg viewBox="0 0 24 24" class="absolute right-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 fill-none stroke-[#8f7bff] lg:hidden" style="stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round"><path d="M9 5l7 7-7 7"/></svg>
          </a>
        </li>`).join('') : '<li class="py-12 text-center text-[#a996e0] lg:col-span-full">Ничего не найдено. Создайте комнату с таким названием.</li>';
    }

    let tt; function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('show'), 2200); }
    function openModal(html, pos = 'right-4 top-4') {
      const sh = $('#sheet'); sh.innerHTML = `<button data-act="close" aria-label="Закрыть" class="absolute ${pos} z-10 grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-black/35 text-white/80 backdrop-blur transition hover:bg-white/15 hover:text-white active:scale-90"><svg viewBox="0 0 24 24" class="ico !h-[18px] !w-[18px]"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` + html; sh.classList.remove('pop'); void sh.offsetWidth; sh.classList.add('pop');
      $('#modal').classList.remove('gone'); const f = sh.querySelector('input'); if (f) setTimeout(() => f.focus(), 60);
    }
    const closeModal = () => $('#modal').classList.add('gone');

    function show(v) {
      $$('[data-view]').forEach(el => { const on = el.dataset.view === v; el.classList.toggle('gone', !on); if (on) { el.classList.remove('fade'); void el.offsetWidth; el.classList.add('fade'); } });
      $$('.navbtn,.tab,.hb').forEach(b => b.classList.toggle('on', b.dataset.nav === v));
      $('#fab').classList.toggle('!hidden', v === 'profile' || v === 'settings'); if (v === 'profile') renderProfile(); if (v === 'settings') renderSettings(); if (v === 'friends') refreshFriends(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    const createModal = () => openModal(`
      <h3 class="pr-10 text-xl font-semibold">Новая комната</h3>
      <p class="mb-5 mt-1 text-sm text-[#a996e0]">Друзья увидят её в списке публичных</p>
      <input id="f-title" maxlength="40" placeholder="Название" class="${INP} mb-3">
      <input id="f-link" placeholder="Ссылка на видео (необязательно)" class="${INP} mb-5">
      <button data-act="submit" class="${BTN1} mb-3">Создать комнату</button>
      <button data-act="close" class="${BTN2}">Отмена</button>`);

    function roomModal(id) {
      const i = id, r = byId(id), n = r.users.length + r.more;
      openModal(`
        <div data-act="join" data-i="${i}" role="button" tabindex="0" aria-label="Войти в комнату" class="group relative grid aspect-video place-items-center overflow-hidden rounded-2xl transition hover:brightness-110 ${r.poster}"><span class="${PLAY}">${PI}</span></div>
        <h3 class="mt-5 text-xl font-semibold">${esc(r.title)}</h3>
        <div class="mb-5 mt-3 flex items-center text-sm text-[#a996e0]">${r.users.map(av).join('')}<span class="ml-3">${n} в комнате</span></div>
        <button data-act="join" data-i="${i}" class="${BTN1} mb-3">Войти в комнату</button>
        <button data-act="copy" data-i="${i}" class="${BTN2}">Скопировать ссылку</button>`, 'right-9 top-9');
    }

    const profileModal = () => openModal(`
      <div class="mb-6 flex items-center gap-4 pr-10">
        ${meAv('h-14 w-14 rounded-full text-xl')}
        <div><h3 class="text-xl font-semibold">${esc(me)}</h3><p class="text-sm text-[#a996e0]">В сети</p></div>
      </div>
      <button data-act="logout" class="${BTN2} mb-3">Выйти</button>
      <button data-act="close" class="${BTN1}">Закрыть</button>`);

    function logout() {
      closeModal(); const r = $('#rooms'), l = $('#login');
      r.classList.add('gone'); r.classList.remove('page-in');
      l.classList.remove('gone', 'leave'); l.classList.add('page-in'); window.scrollTo(0, 0);
    }

    document.addEventListener('click', e => {
      const t = e.target.closest('[data-nav],[data-act],[data-room],[data-invite],a[href="#"]');
      if (!t) { if (e.target.id === 'modal') closeModal(); return; }
      if (t.tagName === 'A') e.preventDefault();
      const d = t.dataset;
      if (d.nav) { closeModal(); return show(d.nav); }
      if (d.room !== undefined) return roomModal(d.room);
      if (d.invite !== undefined) return inviteFriend(d.invite);
      switch (d.act) {
        case 'create': pickFor = null; return openSrc();
        case 'plain': closeSrc(); return createModal();
        case 'pickvideo': if (!curRoom || curRoom.owner !== uid) return toast('Видео выбирает создатель комнаты'); pickFor = curRoom; return openSrc();
        case 'srcback': return srcView ? renderSrc(null) : closeSrc();
        case 'plat': return renderSrc(d.p);
        case 'item': return pickItem(d.p, +d.i);
        case 'go': return goLink();
        case 'ext': window.open(d.u, '_blank', 'noopener'); return;
        case 'profile': return profileModal();
        case 'close': return closeModal();
        case 'logout': return doSignOut();
        case 'leave': stopRoom(); $('#room').classList.add('gone'); $('#rooms').classList.remove('gone'); return;
        case 'soon': return toast('Скоро появится');
        case 'editprof': return editProfileModal();
        case 'pick': return $('#f-file').click();
        case 'nophoto': tp = null; return paintPv();
        case 'saveprof': return saveProfile();
        case 'buy': return buyPremium();
        case 'gopremium': closeModal(); stopRoom(); closeSrc(); $('#room').classList.add('gone'); $('#rooms').classList.remove('gone'); show('profile'); return setTimeout(() => $('#premium').scrollIntoView({ behavior: 'smooth', block: 'start' }), 400);
        case 'edit': return startEdit(d.m);
        case 'editok': return endEdit(d.m, true);
        case 'copyinv': try { navigator.clipboard.writeText(inviteUrl(curRoom)); } catch (_) {} return toast('Ссылка-приглашение скопирована');
        case 'send': return sendMsg();
        
        case 'people': { const r = curRoom; return openModal(`<h3 class="pr-10 text-xl font-semibold">В комнате</h3><div class="mb-5 mt-4 flex items-center">${r.users.map(av).join('')}<span class="ml-3 text-sm text-[#a996e0]">${r.users.length + r.more} человек</span></div><button data-act="copyinv" class="${BTN1} mb-3">Пригласить друзей</button><button data-act="close" class="${BTN2}">Закрыть</button>`); }
        case 'tg': return auth.telegram().then(({ error }) => error && toast('Telegram-вход не настроен в Supabase'));
        case 'join': closeModal(); return enterRoom(d.i);
        case 'joincode': closeModal(); return joinByCode(d.c);
        case 'copy': try { navigator.clipboard.writeText(inviteUrl(byId(d.i))); } catch (_) {} return toast('Ссылка скопирована');
        case 'submit': return submitRoom();
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
      if (e.key === 'Enter' && e.target.id === 'chat-in') sendMsg();
      if (e.key === 'Enter' && e.target.id === 'f-title') $('[data-act="submit"]').click();
      if (e.key === 'Enter' && e.target.closest('#login')) $('#continue').click();
      if ((e.key === 'Enter' || e.key === ' ') && e.target.getAttribute && e.target.getAttribute('role') === 'button') { e.preventDefault(); e.target.click(); }
    });
    $('#q').addEventListener('input', () => render(false));

    /* ---------- иконки и общие стили ---------- */
    const ic = (p, x = '') => `<svg viewBox="0 0 24 24" class="ico ${x}">${p}</svg>`;
    const P = {
      user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5"/>',
      cal: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      glass: '<path d="M7 3h10M7 21h10M8 3v3l4 6-4 6v3M16 3v3l-4 6 4 6v3"/>',
      crowd: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c.6-3.3 3.1-5 6.5-5s5.9 1.7 6.5 5"/><path d="M16 5.2a3.5 3.5 0 010 6.6M18.5 15.3c1.7.7 2.7 2.2 3 4.7"/>',
      gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
      img: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/>',
      bars: '<path d="M6 20V11M12 20V4M18 20v-6"/>', dots: '<path d="M5 5h3v3H5zM10.5 5h3v3h-3zM16 5h3v3h-3zM5 10.5h3v3H5zM10.5 10.5h3v3h-3zM16 10.5h3v3h-3zM5 16h3v3H5zM10.5 16h3v3h-3zM16 16h3v3h-3z"/>',
      play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z"/>', info: '<path d="M4 7h16M4 12h16M4 17h10"/>',
      x: '<path d="M6 6l12 12M18 6L6 18"/>', search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
      add: '<circle cx="10" cy="8.5" r="3.5"/><path d="M3.5 20c.6-3.3 3-5 6.5-5M18 8v6M15 11h6"/>', globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
      mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/>', smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.2c1 1.4 2.1 2 3.5 2s2.5-.6 3.5-2"/><path d="M9 9.5h.01M15 9.5h.01"/>',
      share: '<circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M8.2 10.9l7.6-3.8M8.2 13.1l7.6 3.8"/>', at: '<circle cx="12" cy="12" r="3.5"/><path d="M15.5 12v1.5a2.5 2.5 0 005 0V12a8.5 8.5 0 10-3.4 6.8"/>',
      send: '<path d="M4 12h15M14 6l6 6-6 6"/>'
    };
    const PAUSE = '<svg viewBox="0 0 24 24" class="h-5 w-5 fill-white lg:h-6 lg:w-6"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
    const EYE = ic('<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>', '!h-5 !w-5');
    const EYE_OFF = ic('<path d="M3 3l18 18M10.6 6c.4-.1.9-.1 1.4-.1 6.4 0 10 6.1 10 6.1a17 17 0 01-3.2 3.7M6.3 7.5A16.5 16.5 0 002 12s3.6 6.5 10 6.5c1.6 0 3-.4 4.2-.9"/>', '!h-5 !w-5');
    const CARD = 'relative rounded-3xl border border-[rgba(150,120,255,.28)] bg-gradient-to-br from-[rgba(38,24,82,.7)] to-[rgba(18,12,42,.85)] shadow-[inset_0_0_24px_rgba(120,80,255,.08)]';
    const IB = 'grid h-10 w-10 shrink-0 place-items-center rounded-[13px] border border-[rgba(160,120,255,.4)] bg-[rgba(40,25,90,.6)] text-[#e6dcff] shadow-[0_0_14px_rgba(120,70,255,.2)] transition hover:bg-[rgba(70,45,150,.6)] active:scale-90 max-[380px]:h-9 max-[380px]:w-9';
    const eyeBtn = `<button data-eye aria-label="Скрыть" class="ml-2 grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#8f83bd] transition hover:text-white active:scale-90">${EYE}</button>`;

    /* ---------- ПРОФИЛЬ (всё обнулено) ---------- */
    let bio = '', chartMode = 'bars', vt = 'top';
    const MON = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-eye],[data-chart],[data-vt]'); if (!b) return;
      if (b.dataset.chart) { chartMode = b.dataset.chart; return renderProfile(); }
      if (b.dataset.vt) { vt = b.dataset.vt; return renderProfile(); }
      const off = b.closest('[data-row]').classList.toggle('opacity-40'); b.innerHTML = off ? EYE_OFF : EYE;
    });
    let bt; document.addEventListener('input', e => { if (e.target.id === 'bio') { bio = e.target.value; clearTimeout(bt); bt = setTimeout(() => uid && profile.update(uid, { bio }).then(p => { pfl = p; }).catch(() => {}), 700); } });

    /* ---------- КОМНАТА ---------- */
    let cur = 0, tick, playing = false, pos = 0;
    function enterRoom(id) {
      const r = byId(id); if (!r) return;
      if (S_) endSession();
      curRoom = r; const n = Math.max(1, r.users.length + r.more);
      const ib = (a, p, x = '') => `<button data-act="${a}" class="${IB} ${x}">${ic(p)}</button>`;
      const rm = $('#room');
      rm.innerHTML = `
        <div class="flex items-center justify-between gap-1.5 lg:gap-3">
          <div class="flex gap-1.5 lg:gap-2">${ib('leave', P.x)}${ib('pickvideo', P.play)}${ib('soon', P.gear)}${ib('soon', P.search)}</div>
          <svg class="h-auto w-[62px] shrink-0 lg:w-[84px]" viewBox="0 0 190 90" role="img" aria-label="vibe"><use href="#vibe-logo"/></svg>
          <div class="flex gap-1.5 lg:gap-2">${ib('soon', P.check, 'max-lg:!hidden')}${ib('soon', P.globe, 'max-lg:!hidden')}${ib('copyinv', P.add)}
            <button data-act="people" aria-label="Участники" class="${IB} relative">${ic(P.crowd)}<em id="cnt" class="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-[#ff2d7a] px-1 text-[11px] font-bold not-italic">${n}</em></button></div>
        </div>
        <div class="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:gap-5">
          <div class="flex flex-col lg:min-w-0 lg:flex-1 lg:justify-center">
            <div id="stage" class="relative aspect-video w-full overflow-hidden rounded-[22px] border border-[rgba(150,120,255,.35)] shadow-[0_20px_60px_rgba(0,0,0,.5),0_0_30px_rgba(120,70,255,.2)] ${r.poster}">
              ${stageHtml(r)}
            </div>
            <h2 class="mt-3 truncate px-1 text-lg font-semibold lg:text-2xl">${esc(r.title)}</h2>
          </div>
          <section class="${CARD} flex min-h-0 flex-1 flex-col overflow-hidden p-3 backdrop-blur-xl lg:w-[380px] lg:flex-none lg:p-4">
            <button data-act="copyinv" class="flex items-center gap-3 rounded-2xl border border-[rgba(150,120,255,.28)] bg-[rgba(8,5,20,.45)] p-3 text-left transition hover:border-[rgba(190,150,255,.5)] active:scale-[.98]">
              ${ic(P.share, 'text-[#b79cff]')}<span class="min-w-0 text-sm"><span class="text-[#a996e0]">Ссылка-приглашение</span><br><b id="inv" class="truncate font-semibold text-[#8fb8ff]">${esc(inviteUrl(r).replace(/^https?:\/\//, ''))}</b></span></button>
            <div class="mt-3 flex items-center gap-3 px-1"><i class="h-9 w-9 shrink-0 rounded-full border border-white/20 ${r.poster}"></i><p class="min-w-0 text-sm leading-snug"><span class="text-[#a996e0]">Сейчас играет</span><br><b class="line-clamp-2 font-semibold">${esc(r.title)}</b></p></div>
            <ul id="msgs" class="my-3 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-1"><li id="empty" class="m-auto text-center text-sm text-hint">Здесь пока тихо — напишите первым</li></ul>
            <div class="flex items-center gap-1 rounded-full border border-[rgba(150,120,255,.28)] bg-[rgba(8,5,20,.6)] p-1.5 focus-within:border-violet-vibe">
              <button data-act="soon" aria-label="Голос" class="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#b06bff] to-[#7c4dff] shadow-[0_0_16px_rgba(140,80,255,.6)] transition active:scale-90">${ic(P.mic, 'stroke-white')}</button>
              <input id="chat-in" placeholder="Чат" autocomplete="off" class="min-w-0 flex-1 bg-transparent px-2 text-base text-white outline-none placeholder:text-hint">
              <button data-act="soon" class="grid h-9 w-9 place-items-center text-[#b79cff] max-lg:hidden">${ic(P.at, '!h-5 !w-5')}</button>
              <button data-act="soon" class="grid h-9 w-9 place-items-center text-[#b79cff]">${ic(P.smile, '!h-5 !w-5')}</button>
              <button data-act="soon" class="grid h-9 place-items-center px-1 text-[11px] font-bold tracking-wider text-[#b79cff] max-lg:hidden">GIF</button>
              <button data-act="soon" class="grid h-9 w-9 place-items-center text-[#b79cff] max-[380px]:hidden">${ic(P.img, '!h-5 !w-5')}</button>
              <button data-act="send" aria-label="Отправить" class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-white transition active:scale-90 hover:bg-white/20">${ic(P.send, '!h-5 !w-5')}</button>
            </div>
          </section>
        </div>`;
      rm.classList.remove('gone', 'page-in'); void rm.offsetWidth; rm.classList.add('page-in');
      $('#rooms').classList.add('gone'); window.scrollTo(0, 0);
      startSession(r);
      toast('Вы вошли в «' + r.title + '»');
    }

    /* ---------- профиль пользователя: имя, аватар, premium ---------- */
    Object.assign(P, {
      pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>', heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/>',
      spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
      lock: '<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5"/>', ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>'
    });
    let photo = null, color = 'p', premium = false, until = null, tp, tc, mid = 0;
    const GR = { p: 'from-[#b06bff] to-[#6f5cff]', k: 'from-[#ff4d9a] to-[#b06bff]', o: 'from-[#ff9a3d] to-[#ff4d6a]', b: 'from-[#4da3ff] to-[#6f5cff]', g: 'from-[#22d3a0] to-[#2f8bff]' };
    const meAv = (cls, ph = photo, co = color, nm = me) => ph ? `<img src="${ph}" alt="" class="${cls} object-cover">` : `<b class="${cls} grid place-items-center bg-gradient-to-br ${GR[co]} font-semibold">${esc((nm[0] || 'Г').toUpperCase())}</b>`;
    function paintMe() { $('#me-ava').innerHTML = meAv('h-10 w-10 rounded-full'); $('#me-name').textContent = me; $('#hello').textContent = 'Привет, ' + me; }
    const fmt = d => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    const PBTN = 'h-10 shrink-0 rounded-full bg-gradient-to-r from-[#b06bff] to-[#7c4dff] px-4 text-sm font-medium transition hover:shadow-[0_6px_20px_rgba(130,80,255,.5)] hover:brightness-110 active:scale-95';
    const GBTN = 'h-10 shrink-0 rounded-full border border-[rgba(150,120,255,.35)] px-4 text-sm font-medium text-[#c9b8ff] transition hover:bg-white/10 active:scale-95';
    const PM = 'border border-[rgba(200,160,255,.6)] bg-gradient-to-br from-[rgba(176,107,255,.3)] to-[rgba(79,140,255,.22)] shadow-[0_0_18px_rgba(150,90,255,.4)]';
    const GT = 'bg-gradient-to-r from-[#ff8ad0] to-[#8fb8ff] bg-clip-text text-transparent';

    const lock = (inner, label) => premium ? inner : `<div class="relative"><div class="pointer-events-none select-none blur-[7px] saturate-50" aria-hidden="true">${inner}</div><div class="absolute inset-0 grid place-items-center"><button data-act="gopremium" class="flex items-center gap-2 rounded-full border border-[rgba(220,180,255,.6)] bg-[rgba(30,15,70,.78)] px-4 py-2.5 text-sm font-semibold shadow-[0_0_24px_rgba(170,100,255,.55)] backdrop-blur transition active:scale-95">${ic(P.lock, '!h-4 !w-4')}${label}</button></div></div>`;

    function renderProfile() {
      const d = new Date(), months = [5, 4, 3, 2, 1, 0].map(k => MON[(d.getMonth() - k + 12) % 12]), tz = [40, 72, 28, 88, 56, 64];
      const join = new Date(pfl.created_at || d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
      const head = (p, l, eye = true) => `<div data-row class="flex items-center px-4 py-3 transition">${ic(p, 'mr-3 text-[#d8ccff]')}<h3 class="font-semibold">${l}</h3>${eye ? eyeBtn : ''}</div>`;
      const row = (p, l, v) => `<div data-row class="flex items-center px-4 py-3.5 transition">${ic(p, 'mr-3 text-[#c9b8ff]')}<span class="font-medium">${l}</span><span class="ml-auto text-[15px] text-[#d8ccff]">${v}</span>${eyeBtn}</div>`;
      const seg = (m, pp) => `<button data-chart="${m}" aria-label="${m}" class="grid h-9 w-9 place-items-center rounded-xl transition active:scale-90 ${chartMode === m ? 'bg-[rgba(120,80,255,.4)] text-white shadow-[0_0_12px_rgba(140,90,255,.5)]' : 'text-[#8f83bd] hover:text-white'}">${ic(pp, '!h-5 !w-5')}</button>`;
      const chart = chartMode === 'bars'
        ? `<div class="flex h-28 items-end gap-3 border-b border-white/10 px-1">${months.map((m, i) => `<div class="flex flex-1 flex-col items-center justify-end"><i class="w-full max-w-[34px] rounded-t-lg bg-gradient-to-t from-[#6f5cff] to-[#b06bff] ${premium ? 'opacity-40' : ''}" style="height:${premium ? 4 : tz[i]}px"></i></div>`).join('')}</div><div class="mt-2 flex gap-3 px-1 text-xs text-hint">${months.map(m => `<span class="flex-1 text-center">${m}</span>`).join('')}</div>`
        : `<div class="grid grid-cols-12 gap-1.5">${'<i class="aspect-square rounded-md bg-white/[.06]"></i>'.repeat(60)}</div>`;
      const pill = (k, t) => `<button data-vt="${k}" class="h-9 rounded-full px-5 text-sm font-medium transition active:scale-95 ${vt === k ? 'bg-gradient-to-r from-[#b06bff] to-[#7c4dff] shadow-[0_6px_18px_rgba(130,80,255,.45)]' : 'border border-[rgba(150,120,255,.35)] text-[#c9b8ff] hover:bg-white/10'}">${t}</button>`;
      const av = meAv('h-16 w-16 rounded-full text-2xl');
      const feats = [[P.bars, 'Статистика', 'Часы в комнатах, графики и рекорды'], [P.heart, 'Любимые видео', 'Топ и история просмотров'], [P.pen, 'Редактирование сообщений', 'Поправьте текст после отправки'], [P.spark, 'Премиум-сообщения', 'Неоновая рамка, градиентный ник и значок ✦'], [P.user, 'Рамка аватара', 'Переливающееся кольцо вокруг фото'], [P.lock, 'Приватные комнаты', 'Вход по паролю — только для своих']];
      $('#prof').innerHTML = `
        <div class="${CARD} grad-border flex items-center gap-4 p-4 lg:p-5">
          <button data-act="editprof" aria-label="Изменить аватар" class="relative shrink-0 transition active:scale-95">
            ${premium ? `<span class="block rounded-full bg-gradient-to-br from-[#ff4d9a] via-[#b06bff] to-[#4da3ff] p-[3px] shadow-[0_0_20px_rgba(200,90,255,.65)]">${av}</span>` : `<span class="block rounded-full shadow-[0_0_24px_rgba(140,80,255,.5)]">${av}</span>`}
            <i class="absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full border-2 border-[#150d33] bg-[#7c4dff]">${ic(P.pen, '!h-3 !w-3 stroke-white')}</i></button>
          <div class="min-w-0 flex-1"><div class="flex items-center gap-2"><h2 class="truncate text-xl font-semibold ${premium ? GT : ''}">${esc(me)}</h2>${premium ? '<span class="shrink-0 rounded-full bg-gradient-to-r from-[#ff4d9a] to-[#8a5cff] px-2 py-0.5 text-[10px] font-bold tracking-wider">✦ PREMIUM</span>' : ''}</div>
            <p class="truncate text-sm text-[#a996e0]">@${esc(pfl.handle || '')}</p>
            <button data-act="editprof" class="mt-1 text-sm font-medium text-[#b79cff] hover:text-white">Изменить профиль</button></div>
          <button data-nav="settings" aria-label="Настройки" class="${IB}">${ic(P.gear)}</button>
        </div>
        <div class="${CARD} overflow-hidden">${head(P.user, 'О себе')}<div class="px-4 pb-4"><input id="bio" maxlength="140" value="${esc(bio)}" placeholder="Расскажите о себе" class="${INP} !h-12"></div></div>
        <div class="${CARD} overflow-hidden">${head(P.img, 'Галерея', false)}<div class="px-4 pb-4"><button data-act="soon" aria-label="Добавить фото" class="grid h-36 w-28 place-items-center rounded-2xl border border-dashed border-[rgba(150,120,255,.4)] bg-white/[.04] text-[#c9b8ff] transition hover:bg-white/10 active:scale-95">${ic('<path d="M12 5v14M5 12h14"/>', '!h-8 !w-8')}</button></div></div>
        <div class="${CARD} overflow-hidden">${head(P.bars, 'Статистика', premium)}
          ${lock(`<div class="divide-y divide-white/5">
            <div data-row class="flex items-center px-4 py-3.5"><i class="mr-3 grid h-[22px] w-[22px] place-items-center"><b class="h-[18px] w-[18px] rounded-full bg-[#22e05a] shadow-[0_0_12px_#22e05a]"></b></i><span class="font-medium">В сети</span>${eyeBtn.replace('ml-2', 'ml-auto')}</div>
            ${row(P.cal, 'Дата регистрации', join)}${row(P.clock, 'Время в комнатах', fmtH(pfl.watch_seconds))}
            <div class="px-4 py-4"><div class="mb-3 flex items-center justify-between"><div class="flex gap-1">${seg('bars', P.bars)}${seg('dots', P.dots)}</div><span class="text-xs text-hint">Часы по месяцам</span></div>${chart}<p class="mt-3 text-center text-sm text-hint">Пока нет данных — смотрите вместе, и здесь появится график</p></div>
            ${row(P.crowd, 'Друзья', friends.length)}${row(P.glass, 'Самый долгий сеанс', fmtH(pfl.longest_seconds))}${row(P.crowd, 'Самая большая комната', (pfl.biggest_room || 0) + ' чел.')}</div>`, 'Доступно с VIBE Premium')}</div>
        <div class="${CARD} overflow-hidden"><div class="flex items-center px-4 py-3">${ic(P.heart, 'mr-3 text-[#d8ccff]')}<h3 class="font-semibold">Любимые видео</h3></div>
          ${lock(`<div class="px-4 pb-5"><div class="mb-4 flex gap-2">${pill('top', 'Топ')}${pill('hist', 'История')}</div><div class="grid grid-cols-3 gap-2">${[0, 1, 2].map(i => `<i class="aspect-video rounded-xl ${pool[i + 1]}"></i>`).join('')}</div></div>`, 'Доступно с VIBE Premium')}</div>
        <div id="premium" class="relative overflow-hidden rounded-[28px] border-[1.5px] border-[rgba(220,180,255,.6)] p-5 shadow-[0_0_40px_rgba(170,90,255,.45),inset_0_0_30px_rgba(255,255,255,.08)] lg:p-7" style="background:radial-gradient(90% 70% at 90% 0%,rgba(255,90,170,.5),transparent 60%),radial-gradient(80% 80% at 0% 100%,rgba(70,90,255,.55),transparent 60%),linear-gradient(135deg,#2a1163,#150a36)">
          ${ic(P.spark, 'pointer-events-none absolute -right-4 -top-4 !h-32 !w-32 text-white/15')}
          <h3 class="relative font-cond text-[38px] font-bold uppercase leading-none"><span class="${GT}">VIBE</span> PREMIUM</h3>
          <p class="relative mt-2 text-[#d8ccff]">Больше возможностей для совместного просмотра</p>
          <ul class="relative mt-5 flex flex-col gap-3">${feats.map(f => `<li class="flex items-center gap-3.5"><i class="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[rgba(220,180,255,.4)] bg-white/10 text-[#ffd6f2] shadow-[inset_0_0_14px_rgba(255,255,255,.1)]">${ic(f[0])}</i><div class="min-w-0"><b class="block font-semibold">${f[1]}</b><span class="text-sm leading-snug text-[#c9b8ff]">${f[2]}</span></div></li>`).join('')}</ul>
          <div class="relative mt-6 flex items-end gap-2"><b class="text-4xl font-semibold">129 ₽</b><span class="mb-1 text-[#d8ccff]">/ 30 дней</span></div>
          ${premium ? `<p class="relative mt-2 text-sm font-medium text-[#8fffc8]">✓ Активен до ${fmt(until)}</p>` : ''}
          <button data-act="buy" class="relative mt-4 flex h-[56px] w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#ff4d9a] via-[#b06bff] to-[#6f5cff] text-[17px] font-semibold shadow-[0_10px_34px_rgba(255,80,170,.45),inset_0_1px_0_rgba(255,255,255,.4)] transition hover:brightness-110 active:scale-[.98]">${ic(P.spark, '!h-5 !w-5')}${premium ? 'Продлить на 30 дней' : 'Оформить за 129 ₽'}</button>
        </div>`;
    }

    function premiumModal(t) {
      openModal(`<div class="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#ff4d9a] to-[#8a5cff] shadow-[0_0_28px_rgba(255,80,170,.5)]">${ic(P.spark, '!h-7 !w-7 stroke-white')}</div>
        <h3 class="pr-10 text-xl font-semibold">${t}</h3><p class="mb-5 mt-1.5 text-[#a996e0]">Доступно с VIBE Premium — 129 ₽ / 30 дней</p>
        <button data-act="gopremium" class="${BTN1} mb-3">Подробнее о Premium</button><button data-act="close" class="${BTN2}">Не сейчас</button>`);
    }
    function editProfileModal() {
      tp = photo; tc = color;
      openModal(`<h3 class="pr-10 text-xl font-semibold">Ваш профиль</h3>
        <div class="my-5 flex flex-col items-center gap-3">
          <button data-act="pick" aria-label="Загрузить фото" class="relative transition active:scale-95"><span id="pv"></span><i class="absolute bottom-0 right-0 grid h-9 w-9 place-items-center rounded-full border-2 border-[#120b2b] bg-[#7c4dff]">${ic(P.img, '!h-4 !w-4 stroke-white')}</i></button>
          <div class="flex gap-2"><button data-act="pick" class="${GBTN}">Загрузить фото</button><button data-act="nophoto" class="${GBTN}">Убрать</button></div>
          <div id="sw" class="flex gap-3"></div></div>
        <input id="f-name" maxlength="24" value="${esc(me)}" placeholder="Имя" class="${INP} mb-5">
        <button data-act="saveprof" class="${BTN1} mb-3">Сохранить</button><button data-act="close" class="${BTN2}">Отмена</button>
        <input id="f-file" type="file" accept="image/*" class="hidden">`);
      paintPv();
    }
    function paintPv() {
      $('#pv').innerHTML = meAv('h-24 w-24 rounded-full text-3xl', tp, tc, $('#f-name').value.trim() || me);
      $('#sw').innerHTML = Object.keys(GR).map(k => `<button data-sw="${k}" aria-label="Цвет" class="h-8 w-8 rounded-full bg-gradient-to-br ${GR[k]} transition active:scale-90 ${!tp && tc === k ? 'ring-2 ring-white ring-offset-2 ring-offset-[#120b2b]' : 'opacity-70'}"></button>`).join('');
    }
    document.addEventListener('input', e => { if (e.target.id === 'f-name') paintPv(); });
    document.addEventListener('change', e => {
      if (e.target.id !== 'f-file' || !e.target.files[0]) return;
      const im = new Image(); im.onload = () => {
        const m = Math.min(im.width, im.height), c = document.createElement('canvas'); c.width = c.height = 256;
        c.getContext('2d').drawImage(im, (im.width - m) / 2, (im.height - m) / 2, m, m, 0, 0, 256, 256);
        tp = c.toDataURL('image/jpeg', .88); URL.revokeObjectURL(im.src); paintPv();
      }; im.src = URL.createObjectURL(e.target.files[0]);
    });

    /* ---------- друзья ---------- */
    let ftab = 'friends', fq = '', results = null, sugg = [], recents = [], reqs = [], blocked = []; const sent = new Set();
    const updBadge = () => { const b = $('#hb-badge'); if (!b) return; b.textContent = reqs.length; b.classList.toggle('!hidden', !reqs.length); };
    const isFr = id => friends.some(f => f.id === id);
    async function refreshFriends(quiet) {
      if (!uid) return;
      try {
        const d = await friendsApi.load(uid);
        const pm = await profile.many([...d.friends, ...d.incoming, ...d.outgoing, ...d.blocked, ...d.recents.map(r => r.other_id)]);
        const get = id => pm.get(id) || { id, name: 'Гость', color: 'p', handle: '' };
        const before = reqs.length;
        friends = d.friends.map(get); reqs = d.incoming.map(get); blocked = d.blocked.map(get);
        sent.clear(); d.outgoing.forEach(i => sent.add(i));
        recents = d.recents.map(r => ({ ...get(r.other_id), room: r.room_title }));
        sugg = await friendsApi.suggest(uid);
        if (!quiet && reqs.length > before) toast('Новая заявка в друзья');
      } catch (e) { if (!quiet) toast(errMsg(e)); }
      updBadge(); renderFriends();
    }
    function renderFriends() {
      const q = fq.trim().replace(/^@/, '').toLowerCase();
      const T = [['friends', 'Друзья', P.crowd, 0], ['recents', 'Недавние', P.clock, 0], ['reqs', 'Заявки', P.add, reqs.length], ['blocked', `Блок (${blocked.length})`, P.ban, 0]];
      $('#ftabs').innerHTML = T.map(([k, l, pp, c]) => `<button data-f="tab:${k}" class="relative flex flex-col items-center gap-1 rounded-2xl border py-2.5 text-[11px] transition active:scale-95 ${ftab === k && !q ? 'border-[rgba(160,120,255,.4)] bg-[rgba(70,40,160,.45)] text-white shadow-[0_0_18px_rgba(120,70,255,.25)]' : 'border-transparent text-[#8f83bd] hover:bg-white/5'}">${ic(pp)}${l}${c ? `<em class="absolute right-2 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#ff2d7a] px-1 text-[10px] font-bold not-italic text-white">${c}</em>` : ''}</button>`).join('');
      const li = (u, sub, btns, i = 0) => `<li class="${CARD} rise flex items-center gap-3 p-3.5 lg:hover:border-[rgba(190,150,255,.5)]" style="--i:${i}">${meAv('h-12 w-12 shrink-0 rounded-full text-lg', u.avatar, u.color || 'p', u.name || '?')}<div class="min-w-0 flex-1"><h3 class="truncate font-semibold">${esc(u.name || 'Гость')}</h3><p class="truncate text-sm text-[#a996e0]">${sub}</p></div>${btns}</li>`;
      const addBtn = u => isFr(u.id) ? `<span class="px-2 text-sm text-[#8fffc8]">✓ Друзья</span>`
        : sent.has(u.id) ? `<button disabled class="${GBTN} opacity-70">Отправлено</button>`
        : reqs.some(r => r.id === u.id) ? `<button data-f="acc:${u.id}" class="${PBTN}">Принять</button>`
        : `<button data-f="add:${u.id}" class="${PBTN}">Добавить</button>`;
      const emp = (pp, t, x) => `<li class="${CARD} grid place-items-center gap-2 px-6 py-10 text-center"><i class="grid h-16 w-16 place-items-center rounded-full border border-[rgba(150,120,255,.35)] bg-white/5 text-[#c9b8ff]">${ic(pp, '!h-8 !w-8')}</i><b class="text-lg font-semibold">${t}</b><span class="text-sm text-[#a996e0]">${x}</span></li>`;
      const sub = t => `<li class="ml-1 mt-2 text-sm font-semibold text-[#d8ccff]">${t}</li>`;
      const handle = u => '@' + esc(u.handle || '');
      let h = '';
      if (q) {
        h = results === null ? emp(P.search, 'Ищем…', '')
          : results.length ? results.filter(u => !blocked.some(b => b.id === u.id)).map((u, i) => li(u, handle(u), addBtn(u), i)).join('')
          : emp(P.search, 'Никого не нашли', 'Проверьте ник или имя');
      } else if (ftab === 'friends') {
        h = friends.length ? friends.map((f, i) => {
          const on = lobbyUsers.find(u => u.id === f.id), rm = on && on.room && byId(on.room);
          return li(f, on ? (rm ? 'в комнате «' + esc(rm.title) + '»' : 'в сети') : 'не в сети', `<button data-invite="${f.id}" class="min-w-[104px] ${invited.has(f.id) ? GBTN : PBTN}">${invited.has(f.id) ? 'Приглашён' : 'Позвать'}</button>`, i);
        }).join('') : emp(P.crowd, 'Пока нет друзей', 'Найдите людей через поиск или добавьте из рекомендаций ниже');
        const sg = sugg.filter(u => !isFr(u.id) && !blocked.some(b => b.id === u.id)).slice(0, 4);
        if (sg.length) h += sub('Возможно, вы знакомы') + sg.map((u, i) => li(u, handle(u), addBtn(u), i)).join('');
      } else if (ftab === 'recents') {
        h = recents.length ? recents.map((u, i) => li(u, u.room ? 'вместе в «' + esc(u.room) + '»' : handle(u), addBtn(u), i)).join('') : emp(P.clock, 'Пока пусто', 'Здесь появятся те, с кем вы смотрели вместе');
      } else if (ftab === 'reqs') {
        h = reqs.length ? reqs.map((u, i) => li(u, 'хочет дружить · ' + handle(u), `<div class="flex gap-2"><button data-f="acc:${u.id}" class="${PBTN}">Принять</button><button data-f="dec:${u.id}" aria-label="Отклонить" class="${GBTN} !px-3">${ic(P.x, '!h-4 !w-4')}</button></div>`, i)).join('') : emp(P.add, 'Заявок нет', 'Когда кто-то захочет дружить, заявка появится здесь');
      } else {
        h = blocked.length ? blocked.map((u, i) => li(u, 'заблокирован', `<button data-f="unb:${u.id}" class="${GBTN}">Разблокировать</button>`, i)).join('') : emp(P.ban, 'Список пуст', 'Заблокированных людей нет');
      }
      $('#flist').innerHTML = h;
    }
    let fst; $('#fq').addEventListener('input', e => {
      fq = e.target.value; const q = fq.trim().replace(/^@/, ''); clearTimeout(fst);
      if (!q) { results = null; return renderFriends(); }
      results = null; renderFriends();
      fst = setTimeout(async () => { try { results = await friendsApi.search(q, uid); } catch (_) { results = []; } renderFriends(); }, 250);
    });
    document.addEventListener('click', async e => {
      const b = e.target.closest('[data-f],[data-sw]'); if (!b) return;
      if (b.dataset.sw) { tc = b.dataset.sw; tp = null; return paintPv(); }
      const k = b.dataset.f, i = k.indexOf(':'), a = k.slice(0, i), v = k.slice(i + 1);
      if (a === 'tab') { ftab = v; fq = ''; results = null; $('#fq').value = ''; return renderFriends(); }
      try {
        if (a === 'add') { await friendsApi.add(uid, v); sent.add(v); toast('Заявка отправлена'); }
        if (a === 'acc') { await friendsApi.accept(uid, v); toast('Теперь вы друзья'); }
        if (a === 'dec') await friendsApi.remove(uid, v);
        if (a === 'unb') { await friendsApi.unblock(uid, v); toast('Пользователь разблокирован'); }
      } catch (err) { toast(errMsg(err)); }
      refreshFriends(true);
    });

    /* ---------- сообщения ---------- */
    const EDITED = ' <em class="ml-1 text-[11px] not-italic text-hint">изм.</em>';
    function addMsg(m) {
      if (!$('#msgs') || $('#m' + m.id)) return;
      const e = $('#empty'); if (e) e.remove();
      const u = profile.cache.get(m.user_id) || {}, pr = isPrem(u), mine = m.user_id === uid;
      $('#msgs').insertAdjacentHTML('beforeend', `<li id="m${m.id}" class="rise flex items-start gap-2.5">${meAv('h-8 w-8 shrink-0 rounded-full text-sm', u.avatar, u.color || 'p', u.name || '?')}
        <div class="min-w-0 rounded-2xl rounded-tl-md px-3.5 py-2 ${pr ? PM : 'border border-white/10 bg-white/[.07]'}">
          <div class="mb-0.5 flex items-center gap-2 text-xs font-semibold"><span class="${pr ? GT : 'text-[#b79cff]'}">${esc(u.name || 'Гость')}</span>${pr ? '<span class="text-[#ffb3e6]">✦</span>' : ''}${mine ? `<button data-act="edit" data-m="${m.id}" aria-label="Изменить сообщение" class="ml-auto pl-3 text-[#8f83bd] transition hover:text-white">${ic(P.pen, '!h-3.5 !w-3.5')}</button>` : ''}</div>
          <p data-t data-raw="${esc(m.body)}" class="break-words text-[15px]">${esc(m.body)}${m.edited ? EDITED : ''}</p></div></li>`);
      const box = $('#msgs'); box.scrollTop = box.scrollHeight;
    }
    function updMsg(m) {
      const p = document.querySelector('#m' + m.id + ' [data-t]');
      if (!p || $('#m' + m.id + ' .edit-in') || p.dataset.raw === m.body) return;
      p.dataset.raw = m.body; p.innerHTML = esc(m.body) + EDITED;
    }
    let lastSend = 0;
    async function sendMsg() {
      const inp = $('#chat-in'), t = inp.value.trim().slice(0, 300);
      if (!t || !S_ || Date.now() - lastSend < 350) return;
      lastSend = Date.now(); inp.value = '';
      try { const m = await chat.send(S_.room.id, t); await profile.many([uid]); addMsg(m); }
      catch (e) { inp.value = t; toast(errMsg(e)); }
    }
    function startEdit(id) {
      if (!premium) return premiumModal('Редактирование сообщений');
      const li = $('#m' + id), p = li.querySelector('[data-t]'); if (li.querySelector('.edit-wrap')) return;
      p.classList.add('hidden');
      p.insertAdjacentHTML('afterend', `<div class="edit-wrap mt-1 flex items-center gap-1.5"><input class="edit-in h-9 min-w-0 flex-1 rounded-full border border-[rgba(190,150,255,.5)] bg-black/30 px-3 text-[15px] text-white outline-none" maxlength="300" value="${esc(p.dataset.raw)}"><button data-act="editok" data-m="${id}" aria-label="Сохранить" class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#b06bff] to-[#7c4dff]">${ic(P.check, '!h-4 !w-4 stroke-white')}</button></div>`);
      li.querySelector('.edit-in').focus();
    }
    function endEdit(id, save) {
      const li = $('#m' + id), p = li.querySelector('[data-t]'), inp = li.querySelector('.edit-in'); if (!inp) return;
      const v = inp.value.trim();
      if (save && v && v !== p.dataset.raw) {
        const old = p.dataset.raw; p.dataset.raw = v; p.innerHTML = esc(v) + EDITED;
        chat.edit(id, v).then(() => toast('Сообщение изменено')).catch(e => { p.dataset.raw = old; p.innerHTML = esc(old); toast('Не удалось изменить: ' + errMsg(e)); });
      }
      li.querySelector('.edit-wrap').remove(); p.classList.remove('hidden');
    }
    document.addEventListener('keydown', e => {
      if (!e.target.classList || !e.target.classList.contains('edit-in')) return;
      const id = e.target.closest('li').id.slice(1);
      if (e.key === 'Enter') endEdit(id, true); if (e.key === 'Escape') endEdit(id, false);
    });

    /* ---------- настройки ---------- */
    Object.assign(P, { sl: '<path d="M6 4v16M12 4v16M18 4v16"/><circle cx="6" cy="9" r="2"/><circle cx="12" cy="15" r="2"/><circle cx="18" cy="8" r="2"/>', spk: '<path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4z"/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/>', bell: '<path d="M6 16v-5a6 6 0 0112 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 004 0"/>', sync: '<path d="M20 11a8 8 0 00-14-4L4 9M4 13a8 8 0 0014 4l2-2M4 4v5h5M20 20v-5h-5"/>', pin: '<path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v8"/>', eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>', txt: '<path d="M4 18l5-13 5 13M6 13h6M16 9h4M18 9v9"/>' });
    const S = { tab: 'room', priv: 1, vote: 0, mic: 0, hj: 0, lang: 'Русский', font: 'Системный', bg: 'Тёмный', ni: 1, nc: 1, nb: 1, nd: 1, sync: 1, pin: 0, an: 1, scale: 'Масштаб окна', tr: 1, loc: 0, inv: 0, mat: 1, dat: 0, spk: 'По умолчанию', mcd: 'По умолчанию', vv: 100, vm: 35, gate: 30, ns: 1, agc: 1 };
    try { Object.assign(S, JSON.parse(localStorage.vibeS || '{}')); } catch (_) {}
    let sst; const saveS = () => { try { localStorage.vibeS = JSON.stringify(S); } catch (_) {} clearTimeout(sst); sst = setTimeout(() => uid && profile.update(uid, { settings: S }).catch(() => {}), 800); };
    const CY = {
      priv: [['Приватность', 'Друзья могут войти в комнату', P.crowd, 'Друзья'], ['Приватность', 'Войти может любой', P.globe, 'Все'], ['Приватность', 'Только по ссылке-приглашению', P.lock, 'По ссылке']],
      vote: [['Воспроизведение', 'Голосование во время видео', P.check, 'Голосуем'], ['Воспроизведение', 'Управляет только хост', P.play, 'Хост']],
      mic: [['Голос', 'Микрофоны включены по умолчанию', P.mic, 'Вкл'], ['Голос', 'Микрофоны выключены по умолчанию', P.mic, 'Выкл']]
    };
    const cyc = k => { const [t, d, p, l] = CY[k][S[k]]; return `<button data-st="c:${k}" class="${CARD} flex w-full items-center gap-4 px-5 py-4 text-left transition hover:border-[rgba(190,150,255,.5)] active:scale-[.98]"><span class="min-w-0 flex-1"><b class="block text-[13px] font-semibold uppercase tracking-[.14em]">${t}</b><span class="text-sm text-[#a996e0]">${d}</span></span><span class="grid shrink-0 place-items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[#e6dcff]">${ic(p, '!h-7 !w-7')}${l}</span></button>`; };
    const R = (p, l, c) => `<div class="flex min-h-[58px] items-center gap-3.5 px-4 py-2">${ic(p, 'text-[#d8ccff]')}<span class="min-w-0 flex-1 font-medium">${l}</span>${c}</div>`;
    const SR = (l, k) => `<div class="flex min-h-[48px] items-center gap-3 py-1.5 pl-[52px] pr-4 text-[15px] text-[#d8ccff]"><span class="flex-1">${l}</span>${TG(k)}</div>`;
    const TG = k => `<button role="switch" aria-checked="${!!S[k]}" data-st="t:${k}" class="relative h-7 w-12 shrink-0 rounded-full border transition ${S[k] ? 'border-transparent bg-gradient-to-r from-[#b06bff] to-[#6f5cff] shadow-[0_0_14px_rgba(140,90,255,.6)]' : 'border-[rgba(150,120,255,.3)] bg-[rgba(8,5,20,.6)]'}"><i class="absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white transition-all ${S[k] ? 'left-[24px]' : 'left-1 opacity-70'}"></i></button>`;
    const SEL = (k, o) => `<select data-sel="${k}" class="h-11 w-[160px] max-w-[42vw] rounded-full border border-[rgba(150,120,255,.28)] bg-[rgba(8,5,20,.55)] px-4 text-sm text-white outline-none focus:border-violet-vibe">${o.map(x => `<option class="bg-[#120b2b]" ${x === S[k] ? 'selected' : ''}>${x}</option>`).join('')}</select>`;
    const RG = (k, c = '') => `<span class="w-[50%] max-w-[260px]"><input type="range" min="0" max="100" value="${S[k]}" data-rg="${k}" aria-label="${k}" class="vr ${c}" style="--v:${S[k]}%"></span>`;
    const GRP = (...r) => `<div class="${CARD} divide-y divide-white/5 overflow-hidden">${r.join('')}</div>`;
    const STAB = {
      room: () => `<div class="grid gap-3 lg:grid-cols-2 lg:items-start"><div class="grid gap-3">${cyc('priv')}${cyc('vote')}${cyc('mic')}</div>${GRP(R(P.ban, 'Скрывать сообщения о входе и выходе', TG('hj')))}</div>`,
      prefs: () => `<div class="grid gap-3 lg:grid-cols-2 lg:items-start">
        ${GRP(R(P.globe, 'Язык', SEL('lang', ['Русский', 'English'])), R(P.txt, 'Шрифт', SEL('font', ['Системный', 'Inter', 'Oswald'])), R(P.img, 'Фон окна', SEL('bg', ['Тёмный', 'Светящийся', 'Однотонный'])),
          R(P.bell, 'Уведомления', ''), SR('Приглашения', 'ni'), SR('Пропущенные сообщения', 'nc'), SR('Буфер обмена', 'nb'), SR('Личные сообщения', 'nd'),
          R(P.sync, 'Точная синхронизация', TG('sync')), R(P.pin, 'Закреплённые комнаты', TG('pin')), R(P.play, 'Анимации переходов', TG('an')), R(P.dots, 'Масштаб', SEL('scale', ['Масштаб окна', '100%', '125%'])))}
        ${GRP(R(P.globe, 'Автоперевод чата', TG('tr')), R(P.eye, 'Скрывать местоположение', TG('loc')), R(P.lock, 'Ограничить приглашения', TG('inv')), R(P.ban, 'Скрывать 18+ контент', TG('mat')), R(P.bars, 'Не передавать мои данные третьим лицам', TG('dat')), R(P.info, 'Версия', '<span class="text-[#a996e0]">vibe 1.0</span>'))}</div>`,
      audio: () => `<div class="mx-auto max-w-[640px]">${GRP(R(P.spk, 'Динамик', SEL('spk', ['По умолчанию', 'Наушники', 'Колонки'])), R(P.crowd, 'Громкость голосов', RG('vv')), R(P.play, 'Громкость видео', RG('vm')), R(P.mic, 'Микрофон', SEL('mcd', ['По умолчанию', 'Встроенный', 'Гарнитура'])), R(P.ban, 'Порог шума', RG('gate', 'gate')), R(P.bars, 'Шумоподавление', TG('ns')), R(P.crowd, 'Авто-громкость микрофона', TG('agc')))}
        <div class="mt-5 flex flex-col items-center gap-3"><div class="h-1.5 w-full max-w-[260px] overflow-hidden rounded bg-white/10"><i id="meter" class="block h-full w-0 rounded bg-gradient-to-r from-[#22d3a0] to-[#b06bff] transition-[width] duration-75"></i></div>
        <button data-st="test:x" class="${GBTN} !h-11 !px-8">Проверить микрофон</button></div></div>`
    };
    function renderSettings() {
      const T = [['room', 'Комната', P.play], ['prefs', 'Настройки', P.sl], ['audio', 'Аудио', P.mic]];
      $('#stg').innerHTML = `<h2 class="text-2xl font-semibold tracking-tight lg:text-4xl">Настройки</h2><p class="mt-1 text-[#a996e0] lg:mt-2 lg:text-lg">Комната, приложение и звук</p>
        <div class="mt-5 grid grid-cols-3 gap-2 lg:max-w-[560px]">${T.map(([k, l, p]) => `<button data-st="tab:${k}" class="flex flex-col items-center gap-1 rounded-2xl border py-2.5 text-xs transition active:scale-95 ${S.tab === k ? 'border-[rgba(160,120,255,.4)] bg-[rgba(70,40,160,.45)] text-white shadow-[0_0_18px_rgba(120,70,255,.25)]' : 'border-transparent text-[#8f83bd] hover:bg-white/5'}">${ic(p)}${l}</button>`).join('')}</div>
        <div class="fade mt-4">${STAB[S.tab]()}</div>`;
    }
    async function micTest() {
      try {
        const st = await navigator.mediaDevices.getUserMedia({ audio: true }), ac = new AudioContext(), an = ac.createAnalyser(), d = new Uint8Array(an.fftSize), t0 = Date.now();
        ac.createMediaStreamSource(st).connect(an); toast('Говорите — идёт проверка');
        (function f() { an.getByteTimeDomainData(d); let x = 0; for (const v of d) x = Math.max(x, Math.abs(v - 128)); const m = $('#meter'); if (m) m.style.width = Math.min(100, x / 64 * 100) + '%';
          if (m && Date.now() - t0 < 8000) requestAnimationFrame(f); else { st.getTracks().forEach(t => t.stop()); ac.close(); } })();
      } catch (_) { toast('Нет доступа к микрофону'); }
    }
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-st]'); if (!b) return;
      const [a, k] = b.dataset.st.split(':');
      if (a === 'test') return micTest();
      if (a === 'tab') S.tab = k; if (a === 't') S[k] = +!S[k]; if (a === 'c') S[k] = (S[k] + 1) % CY[k].length;
      saveS(); renderSettings();
    });
    document.addEventListener('change', e => { const k = e.target.dataset && e.target.dataset.sel; if (k) { S[k] = e.target.value; saveS(); } });
    document.addEventListener('input', e => { const k = e.target.dataset && e.target.dataset.rg; if (k) { S[k] = +e.target.value; e.target.style.setProperty('--v', S[k] + '%'); saveS(); } });


/* ===== Выбор площадки + реальный плеер ===== */
let pickFor = null, srcView = null;
const PL = {
  vk: { n: 'VK Видео', sub: 'Фильмы, сериалы и ролики ВКонтакте', site: 'https://vkvideo.ru', q: 'https://vk.com/video?q=' },
  yt: { n: 'YouTube', sub: 'Подборка: бесплатное кино и клипы', site: 'https://www.youtube.com', q: 'https://www.youtube.com/results?search_query=' },
  rt: { n: 'Rutube', sub: 'Фильмы, сериалы и шоу', site: 'https://rutube.ru', q: 'https://rutube.ru/search/?query=' },
  nf: { n: 'Netflix', sub: 'Популярное на Netflix', site: 'https://www.netflix.com', q: 'https://www.netflix.com/search?q=' }
};
const LOGO = {
  vk: '<svg viewBox="0 0 100 100"><rect width="100" height="100" rx="26" fill="#0077ff"/><path d="M39 31v38l32-19z" fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"/></svg>',
  yt: '<svg viewBox="0 0 100 100"><rect x="2" y="16" width="96" height="68" rx="22" fill="#f00"/><path d="M41 34v32l27-16z" fill="#fff"/></svg>',
  rt: '<svg viewBox="0 0 100 100"><defs><linearGradient id="rtg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff3d6e"/><stop offset="1" stop-color="#5a3dff"/></linearGradient></defs><rect width="100" height="100" rx="26" fill="#12101f"/><circle cx="50" cy="50" r="30" fill="url(#rtg)"/><path d="M43 36v28l23-14z" fill="#fff"/></svg>',
  nf: '<svg viewBox="0 0 100 100"><rect width="100" height="100" rx="26" fill="#0b0b0b"/><path d="M33 18h12v64H33zM55 18h12v64H55z" fill="#b1060f"/><path d="M33 18h12l22 64H55z" fill="#e50914"/></svg>'
};
const CAT = {
  yt: [['YE7VzlLtp-4', 'Big Buck Bunny'], ['eRsGyueVLvQ', 'Sintel'], ['R6MlUcmOul8', 'Tears of Steel'], ['dQw4w9WgXcQ', 'Rick Astley — Never Gonna Give You Up'], ['jNQXAC9IjXY', 'Me at the zoo'], ['9bZkp7q19f0', 'PSY — Gangnam Style']],
  nf: [['Очень странные дела'], ['Уэнсдей'], ['Игра в кальмара'], ['Ведьмак'], ['Тьма'], ['Бриджертоны'], ['Бумажный дом'], ['Ход королевы']]
};
const openSrc = () => { $('#src').classList.remove('gone'); renderSrc(null); };
const closeSrc = () => $('#src').classList.add('gone');

function srcCard(v, it, i) {
  const yt = v === 'yt';
  return `<button data-act="item" data-p="${v}" data-i="${i}" class="group rise text-left" style="--i:${i}">
    <span class="relative grid aspect-video place-items-center overflow-hidden rounded-2xl border border-[rgba(150,120,255,.28)] transition group-hover:border-[rgba(190,150,255,.65)] group-hover:shadow-[0_12px_36px_rgba(140,80,255,.35)] ${yt ? 'bg-black' : pool[i % 5]}">
      ${yt ? `<img loading="lazy" alt="" src="https://i.ytimg.com/vi/${it[0]}/hqdefault.jpg" class="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-110" onerror="this.remove()"><span class="${PLAY}">${PI}</span>`
           : `<span class="px-3 text-center font-cond text-xl font-bold uppercase leading-tight [text-shadow:0_2px_12px_#000]">${esc(it[0])}</span><i class="absolute right-2 top-2 h-6 w-6">${LOGO.nf}</i>`}
    </span><h3 class="mt-2 truncate text-sm font-semibold">${esc(it[yt ? 1 : 0])}</h3></button>`;
}

function renderSrc(v) {
  srcView = v;
  const back = `<button data-act="srcback" aria-label="Назад" class="${IB}">${ic(v ? '<path d="M15 5l-7 7 7 7"/>' : P.x)}</button>`;
  const top = `<div class="mx-auto flex max-w-[1100px] items-center justify-between">${back}<svg class="h-auto w-[72px]" viewBox="0 0 190 90"><use href="#vibe-logo"/></svg><span class="w-10"></span></div>`;
  let body;
  if (!v) {
    body = `<div class="mx-auto mt-8 max-w-[1100px]"><h2 class="fade text-2xl font-semibold tracking-tight lg:text-4xl">Что смотрим?</h2>
      <p class="mt-1 text-[#a996e0] lg:text-lg">Выберите площадку — откроется её страница с видео</p>
      <div class="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-6">${Object.keys(PL).map((k, i) => `
        <button data-act="plat" data-p="${k}" class="group rise ${CARD} flex flex-col items-center gap-4 p-6 transition hover:-translate-y-1 hover:border-[rgba(190,150,255,.65)] hover:shadow-[0_18px_50px_rgba(140,80,255,.35)] active:scale-95 lg:p-9" style="--i:${i}">
          <span class="block h-20 w-20 drop-shadow-[0_8px_24px_rgba(0,0,0,.5)] transition group-hover:scale-110 lg:h-28 lg:w-28">${LOGO[k]}</span>
          <b class="font-semibold lg:text-lg">${PL[k].n}</b></button>`).join('')}</div>
      <button data-act="plain" class="${BTN2} mx-auto mt-8 max-w-[360px]">Создать пустую комнату</button></div>`;
  } else {
    const p = PL[v], list = CAT[v];
    body = `<div class="mx-auto mt-6 max-w-[1100px]">
      <div class="rise flex items-center gap-4"><span class="h-16 w-16 shrink-0">${LOGO[v]}</span><div><h2 class="text-2xl font-semibold lg:text-4xl">${p.n}</h2><p class="text-sm text-[#a996e0]">${p.sub}</p></div></div>
      <div class="mt-5 flex flex-col gap-3 lg:flex-row"><input id="src-in" placeholder="Вставьте ссылку на видео" class="${INP} lg:flex-1">${v === 'vk' ? `<input id="src-hash" placeholder="hash (обязательно): …video_ext.php?…&hash=…" autocomplete="off" class="${INP} lg:flex-1">` : ''}
        <button data-act="go" class="${BTN1} lg:!w-[190px]">Смотреть</button>
        <button data-act="ext" data-u="${p.site}" class="${BTN2} lg:!w-[240px]">Открыть ${p.n} ↗</button></div>
      ${list ? `<h3 class="mb-3 mt-8 text-lg font-semibold">${v === 'nf' ? 'Популярное' : 'Выберите видео'}</h3><div class="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">${list.map((it, i) => srcCard(v, it, i)).join('')}</div>`
        : `<p class="${CARD} mt-8 p-6 text-[#a996e0]">Нажмите «Открыть ${p.n}», найдите фильм, скопируйте ссылку из адресной строки и вставьте выше — комната запустится с этим видео.</p>`}</div>`;
  }
  const s = $('#src'); s.innerHTML = top + body; s.scrollTop = 0;
}

function parseLink(u) {
  let x;
  if (x = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/)) return { type: 'yt', id: x[1] };
  if (x = u.match(/rutube\.ru\/(?:video\/(?:private\/)?|play\/embed\/)([0-9a-f]{32})(?:.*[?&]p=([\w-]+))?/i)) return { type: 'rt', id: x[1], p: x[2] || '' };
  if (/(?:vk\.com|vkvideo\.ru)\//i.test(u)) {
    let q; try { q = new URL(u).searchParams; } catch (_) { q = new URLSearchParams(); }
    let oid = q.get('oid'), id = q.get('id');
    if (!oid || !id) { const w = u.match(/video(-?\d+)_(\d+)/); if (w) { oid = w[1]; id = w[2]; } }
    if (/^-?\d+$/.test(oid || '') && /^\d+$/.test(id || '')) return { type: 'vk', oid, id, h: q.get('hash') || (u.match(/[?&]hash=(\w+)/) || [])[1] || '' };
  }
  return null;
}

function pickItem(p, i) {
  const it = CAT[p][i];
  launch(p === 'yt' ? { type: 'yt', id: it[0], title: it[1], thumb: `https://i.ytimg.com/vi/${it[0]}/hqdefault.jpg` } : { type: 'nf', q: it[0], title: it[0] });
}
function resolveMedia(v, hashIn) {
  const m = parseLink(v); if (!m) return { err: 'Не удалось распознать ссылку' };
  if (m.type === 'vk') {
    const h = String(hashIn || m.h || '').trim();
    if (!/^[0-9a-f]{8,32}$/i.test(h)) return { err: 'Для VK нужен hash: скопируйте его из кода вставки (…&hash=…)' };
    m.h = h;
  }
  return { m };
}
function goLink() {
  const v = ($('#src-in').value || '').trim(), hi = $('#src-hash'), r = resolveMedia(v, hi && hi.value);
  if (r.err) { toast(r.err); if (hi && /hash/.test(r.err)) hi.focus(); return; }
  const m = r.m;
  if (m.type === 'yt') {
    m.thumb = `https://i.ytimg.com/vi/${m.id}/hqdefault.jpg`;
    return fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(v)).then(x => x.json()).then(j => { m.title = j.title; launch(m); }).catch(() => launch(m));
  }
  launch(m);
}

document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'src-in') goLink(); if (e.key === 'Escape') closeSrc(); });

/* ================= BACKEND-ИНТЕГРАЦИЯ ================= */
const errMsg = e => {
  const m = String((e && (e.message || e.error_description)) || e || '');
  if (/host_only/.test(m)) return 'Управляет только хост';
  if (/payment_required/.test(m)) return 'Оплата ещё не подключена';
  if (/row-level security|permission denied|42501/.test(m)) return 'Недостаточно прав';
  if (/duplicate key|23505/.test(m)) return 'Уже отправлено';
  if (/Failed to fetch|NetworkError/.test(m)) return 'Нет связи с сервером';
  return m.slice(0, 120) || 'Ошибка';
};
const authMsg = e => {
  const m = String((e && e.message) || '');
  if (/Invalid login/i.test(m)) return 'Неверная почта или пароль';
  if (/already registered/i.test(m)) return 'Эта почта уже зарегистрирована';
  if (/Email not confirmed/i.test(m)) return 'Подтвердите почту по ссылке из письма';
  if (/rate limit|too many/i.test(m)) return 'Слишком много попыток, попробуйте позже';
  if (/Password should/i.test(m)) return 'Пароль слишком простой (минимум 8 символов)';
  return errMsg(e);
};
const byId = id => rooms.find(r => r.id === id);
const inviteUrl = r => `${location.origin}${location.pathname}#r=${r.code}`;
const fmtH = s => { s = +s || 0; return s < 3600 ? Math.round(s / 60) + ' мин' : (s / 3600).toFixed(1).replace(/\.0$/, '') + ' ч'; };
const mkey = m => (m ? [m.type, m.id || m.q || '', m.oid || ''].join(':') : '');
const sortRooms = () => rooms.sort((a, b) => b.created - a.created);
let unsubs = [], pst, pt2;

function applyProfile() {
  me = pfl.name; color = pfl.color; photo = pfl.avatar; bio = pfl.bio || '';
  until = pfl.premium_until ? new Date(pfl.premium_until) : null; premium = isPrem(pfl);
}
async function reloadProfile() { pfl = await profile.get(uid); applyProfile(); paintMe(); }

/* ---------- комнаты ---------- */
function upsertRoom(row) {
  const media = validMedia(row.media);
  const base = {
    id: row.id, code: row.code, title: row.title, owner: row.owner, privacy: row.privacy, host_only: row.host_only,
    poster: pool[row.poster % pool.length], media, thumb: media && media.thumb, state: row.state || {}, created: Date.parse(row.created_at),
    progress: row.state && row.state.playing ? Math.max(1, row.state.pct || 0) : 0,
  };
  let r = byId(row.id);
  if (r) Object.assign(r, base); else { r = { ...base, users: [], more: 0 }; rooms.push(r); }
  applyPresence(r);
  return r;
}
function applyPresence(r) {
  const us = lobbyUsers.filter(u => u.room === r.id);
  r.users = us.slice(0, 5).map(u => [(Array.from(u.name || '?')[0] || '?').toUpperCase(), C[u.color] ? u.color : 'p']);
  r.more = Math.max(0, us.length - 5);
}
function onPresence(list) {
  lobbyUsers = list; rooms.forEach(applyPresence);
  clearTimeout(pst);
  pst = setTimeout(() => {
    if (!$('#rooms').classList.contains('gone')) { render(false); if (!document.querySelector('[data-view="friends"]').classList.contains('gone')) renderFriends(); }
    updRoomUI();
  }, 250);
}
function updRoomUI() {
  const s = S_; if (!s) return;
  const us = lobbyUsers.filter(u => u.room === s.room.id), c = $('#cnt');
  if (c) c.textContent = Math.max(1, us.length);
  s.peak = Math.max(s.peak, us.length);
  us.forEach(u => { if (u.id !== uid && !s.met.has(u.id)) { s.met.add(u.id); friendsApi.touch(uid, u.id, s.room.title).catch(() => {}); } });
}
function onRoomChange(p) {
  if (p.eventType === 'DELETE') {
    const id = p.old.id; rooms = rooms.filter(r => r.id !== id);
    if (S_ && S_.room.id === id) { stopRoom(); $('#room').classList.add('gone'); $('#rooms').classList.remove('gone'); toast('Комната закрыта'); }
  } else {
    const r = upsertRoom(p.new); sortRooms();
    if (S_ && S_.room === r && mkey(r.media) !== S_.mk && r.media) swapMedia(r, r.media);
  }
  render(false);
}
async function joinByCode(code) {
  try {
    const row = await roomsApi.byCode(code);
    if (!row) return toast('Комната не найдена');
    const r = upsertRoom(row); sortRooms(); render(false); enterRoom(r.id);
  } catch (e) { toast(errMsg(e)); }
}
async function createRoomFlow(title, media) {
  try {
    const row = await roomsApi.create({ title: title.slice(0, 40), owner: uid, privacy: S.priv, host_only: !!S.vote, poster: Math.floor(Math.random() * pool.length), media });
    const r = upsertRoom(row); sortRooms(); $('#q').value = ''; show('rooms'); render(true);
    toast('Комната «' + r.title + '» создана'); enterRoom(r.id);
  } catch (e) { toast(errMsg(e)); }
}
async function submitRoom() {
  const v = $('#f-title').value.trim();
  if (!v) { toast('Введите название комнаты'); return $('#f-title').focus(); }
  const link = $('#f-link').value.trim(); let media = null;
  if (link) {
    const r = resolveMedia(link, ''); if (r.err) return toast(r.err);
    media = validMedia(r.m); if (!media) return toast('Некорректная ссылка на видео');
  }
  closeModal(); await createRoomFlow(v, media);
}
async function launch(m0) {
  const m = validMedia({ ...m0, title: m0.title || PL[m0.type].n + ' — по ссылке' });
  if (!m) return toast('Некорректная ссылка на видео');
  try {
    if (pickFor) {
      const r = pickFor; pickFor = null;
      const row = await roomsApi.setMedia(r.id, m); upsertRoom(row); closeSrc();
      const st = { playing: false, t: 0, ts: now(), by: uid };
      swapMedia(r, m, st); if (S_ && S_.sync) S_.sync.media({ media: m, state: st });
      return;
    }
    closeSrc(); await createRoomFlow(m.title, m);
  } catch (e) { toast(errMsg(e)); }
}
function inviteFriend(id) {
  if (!curRoom) return toast('Сначала зайдите в комнату');
  invited.add(id); renderFriends();
  invites.send(id, { code: curRoom.code, title: curRoom.title, from: me }).then(() => toast('Приглашение отправлено')).catch(() => { invited.delete(id); renderFriends(); toast('Не удалось отправить приглашение'); });
}
function onInvite(p) {
  if (!p || !p.code) return;
  openModal(`<h3 class="pr-10 text-xl font-semibold">${esc(String(p.from || 'Друг'))} зовёт смотреть</h3><p class="mb-5 mt-1.5 text-[#a996e0]">«${esc(String(p.title || ''))}»</p><button data-act="joincode" data-c="${esc(String(p.code).replace(/[^\w]/g, ''))}" class="${BTN1} mb-3">Войти в комнату</button><button data-act="close" class="${BTN2}">Позже</button>`);
}

/* ---------- сессия просмотра: плеер + синхронизация + чат ---------- */
const expected = st => ({ playing: !!st.playing, t: (+st.t || 0) + (st.playing ? Math.max(0, (now() - (st.ts || now())) / 1000) : 0) });
const pctOf = s => { const p = s.player, d = p && p.dur(); return d ? Math.min(100, Math.round(p.time() / d * 100)) : 0; };
const stageHtml = r => r.media ? '<div id="plw" class="absolute inset-0 bg-black"></div>'
  : `<div class="absolute inset-0 grid place-items-center p-4 text-center"><div class="flex flex-col items-center gap-4"><span class="font-cond text-[clamp(22px,5vw,54px)] font-bold uppercase leading-none text-white [text-shadow:0_2px_14px_rgba(0,0,0,.7)]">${esc(r.title)}</span>${
    r.owner === uid ? `<button data-act="pickvideo" class="${BTN1} !h-11 !w-auto px-6 text-sm">Выбрать видео</button>` : '<span class="text-sm text-[#d8ccff]">Ждём, пока создатель выберет видео</span>'}</div></div>`;

async function startSession(r) {
  const s = S_ = { room: r, t0: Date.now(), player: null, state: r.state && r.state.ts ? r.state : { playing: false, t: 0, ts: now() }, unsub: [], peak: 1, met: new Set(), mk: mkey(r.media), iv: 0, sync: null };
  lobby.setRoom(r.id);
  try {
    const row = await roomsApi.one(r.id); if (S_ !== s) return;
    upsertRoom(row); if (row.state && row.state.ts) s.state = row.state;
    if (mkey(r.media) !== s.mk) { s.mk = mkey(r.media); const stg = $('#stage'); if (stg) stg.innerHTML = stageHtml(r); }
  } catch (_) {}
  s.sync = joinSync(r.id, {
    onState: st => { if (S_ !== s || !st) return; s.state = st; s.player && s.player.apply(expected(st)); },
    onMedia: p => { const m = validMedia(p && p.media); if (S_ === s && m) swapMedia(r, m, p.state); },
    onHello: () => { if (S_ === s && s.player && s.state.by === uid) s.sync.state({ playing: s.state.playing, t: s.player.time(), ts: now(), by: uid, pct: pctOf(s) }); },
    onReady: () => s.sync.hello(),
  });
  s.iv = setInterval(() => {
    if (!s.player || !s.state.playing) return;
    const e = expected(s.state); if (Math.abs(s.player.time() - e.t) > 2.5) s.player.apply(e);
  }, 4000);
  try {
    const hist = await chat.history(r.id); await profile.many(hist.map(m => m.user_id)); if (S_ !== s) return;
    hist.forEach(addMsg);
    s.unsub.push(chat.watch(r.id, async (ev, m) => { await profile.many([m.user_id]); if (S_ !== s) return; ev === 'ins' ? addMsg(m) : updMsg(m); }));
  } catch (e) { toast(errMsg(e)); }
  updRoomUI();
  if (r.media) mountPlayer(r.media);
}
function endSession() {
  const s = S_; if (!s) return; S_ = null; curRoom = null;
  clearInterval(s.iv); s.unsub.forEach(f => f()); s.sync && s.sync.stop(); s.player && s.player.destroy();
  if (lobby) lobby.setRoom(null);
  const sec = Math.round((Date.now() - s.t0) / 1000);
  if (sec >= 30 && uid) {
    profile.watch(sec, s.peak).then(() => { pfl.watch_seconds = (pfl.watch_seconds || 0) + sec; pfl.longest_seconds = Math.max(pfl.longest_seconds || 0, sec); pfl.biggest_room = Math.max(pfl.biggest_room || 0, s.peak); });
  }
}
function stopRoom() { endSession(); $('#room').innerHTML = ''; }
async function mountPlayer(m) {
  const s = S_, box = $('#plw'); if (!s || !box) return;
  if (m.type === 'nf') {
    box.innerHTML = `<div class="absolute inset-0 grid place-items-center bg-gradient-to-br from-[#2a0509] to-black p-4 text-center"><div class="flex flex-col items-center gap-3"><span class="h-14 w-14">${LOGO.nf}</span><b class="text-lg">${esc(m.title)}</b><p class="max-w-[320px] text-xs text-[#d8ccff]">Netflix не разрешает встраивать свой плеер на сторонние сайты. Откройте фильм у себя и смотрите вместе, общаясь в чате.</p><button data-act="ext" data-u="${PL.nf.q + encodeURIComponent(m.q)}" class="${BTN1} !h-11 !w-auto px-6 text-sm">Открыть в Netflix</button></div></div>`;
    return;
  }
  const pl = await createPlayer(box, m, { onLocal: onLocalEv, onError: toast });
  if (!pl) return;
  if (S_ !== s || s.room.media !== m && mkey(s.room.media) !== mkey(m)) return pl.destroy();
  s.player = pl; pl.apply(expected(s.state));
}
function swapMedia(r, m, st) {
  r.media = m; r.thumb = m.thumb; render(false);
  const s = S_; if (!s || s.room !== r) return;
  if (s.player) { s.player.destroy(); s.player = null; }
  s.mk = mkey(m); s.state = st && st.ts ? st : { playing: false, t: 0, ts: now(), by: uid };
  const stg = $('#stage'); if (stg) stg.innerHTML = stageHtml(r);
  mountPlayer(m);
}
function onLocalEv(ev) {
  const s = S_; if (!s) return; const r = s.room;
  if (r.host_only && r.owner !== uid) return s.player && s.player.apply(expected(s.state));
  const st = { playing: ev.type === 'seek' ? ev.playing : ev.type === 'play', t: ev.t, ts: now(), by: uid, pct: pctOf(s) };
  s.state = st; r.state = st; s.sync.state(st);
  clearTimeout(pt2); pt2 = setTimeout(() => roomsApi.saveState(r.id, st).catch(() => {}), 350);
}

/* ---------- авторизация ---------- */
let mode = 'in', authBusy = false;
const authErr = t => { const e = $('#auth-err'); e.textContent = t || ''; e.classList.toggle('gone', !t); };
function setMode(m) {
  mode = m; authErr('');
  $('#name-wrap').classList.toggle('gone', m === 'in');
  $('#cont-t').textContent = m === 'in' ? 'Войти' : 'Создать аккаунт';
  $('#auth-mode').textContent = m === 'in' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти';
  $('#pw').autocomplete = m === 'in' ? 'current-password' : 'new-password';
}
$('#auth-mode').addEventListener('click', () => setMode(mode === 'in' ? 'up' : 'in'));
$('#continue').addEventListener('click', async () => {
  if (authBusy) return;
  const email = $('#email').value.trim(), pw = $('#pw').value, name = $('#name').value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return authErr('Введите корректную почту');
  if (pw.length < 8) return authErr('Пароль — минимум 8 символов');
  if (mode === 'up' && !name) return authErr('Введите имя');
  authBusy = true; $('#continue').disabled = true; authErr('');
  try {
    if (mode === 'in') await auth.signIn(email, pw);
    else { const r = await auth.signUp(email, pw, name); if (!r.session) { setMode('in'); toast('Подтвердите почту — письмо отправлено'); } }
  } catch (e) { authErr(authMsg(e)); }
  authBusy = false; $('#continue').disabled = false;
});

function toApp() {
  const login = $('#login'), rm = $('#rooms');
  const open = () => { rm.classList.remove('gone', 'page-in'); void rm.offsetWidth; rm.classList.add('page-in'); window.scrollTo(0, 0); };
  if (login.classList.contains('gone')) return open();
  login.classList.remove('page-in'); login.classList.add('leave');
  setTimeout(() => { login.classList.add('gone'); login.classList.remove('leave'); open(); }, 420);
}
async function enterApp(user) {
  uid = user.id;
  await syncClock();
  pfl = await profile.get(uid); applyProfile();
  try { Object.assign(S, pfl.settings || {}); } catch (_) {}
  lobby = joinLobby({ id: uid, name: me, color }, onPresence);
  const list = await roomsApi.list(); rooms = []; list.forEach(upsertRoom); sortRooms();
  unsubs = [roomsApi.watch(onRoomChange), friendsApi.watch(() => refreshFriends()), invites.listen(uid, onInvite)];
  refreshFriends(true);
  paintMe(); render(true); toApp();
  const h = location.hash.match(/^#r=(\w+)/);
  if (h) { history.replaceState(null, '', location.pathname + location.search); joinByCode(h[1]); }
}
function teardown() {
  unsubs.forEach(f => f()); unsubs = []; stopRoom(); if (lobby) lobby.stop(); lobby = null;
  rooms = []; friends = []; reqs = []; blocked = []; recents = []; sugg = []; sent.clear(); lobbyUsers = [];
  uid = null; pfl = {}; premium = false; until = null; photo = null; bio = ''; me = 'Гость'; profile.cache.clear();
}
async function handleAuth(ev, s) {
  if (ev === 'SIGNED_OUT') { teardown(); closeSrc(); $('#room').classList.add('gone'); return logout(); }
  if (!s) { if (ev === 'INITIAL_SESSION') logout(); return; }
  if ((ev === 'INITIAL_SESSION' || ev === 'SIGNED_IN') && uid !== s.user.id) {
    try { await enterApp(s.user); } catch (e) { toast(errMsg(e)); await auth.out(); }
  }
}
async function doSignOut() { closeModal(); stopRoom(); closeSrc(); $('#room').classList.add('gone'); await auth.out(); }

/* ---------- профиль / Premium ---------- */
async function saveProfile() {
  const n = $('#f-name').value.trim();
  if (!n) { toast('Введите имя'); return $('#f-name').focus(); }
  try {
    pfl = await profile.update(uid, { name: n.slice(0, 24), color: tc, avatar: tp });
    applyProfile(); if (lobby) lobby.setInfo({ name: me, color });
    closeModal(); paintMe(); renderProfile(); toast('Профиль обновлён');
  } catch (e) { toast(errMsg(e)); }
}
async function buyPremium() {
  try { await profile.buy(); await reloadProfile(); renderProfile(); toast('VIBE Premium активирован'); }
  catch (e) { toast(errMsg(e)); }
}

boot();
async function boot() {
  setMode('in');
  auth.on(handleAuth);
}
