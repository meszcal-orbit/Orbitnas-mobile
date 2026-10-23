// Start der App: Grundgerüst, Navigation, Sperre, Abgleich im Hintergrund, Updates.

import { h, icon, toast, clear } from './util.js';
import { state, init, sync, onChange, openJobs } from './sync.js';
import { persist } from './db.js';
import { loadSettings, route, go, unlocked, isWide } from './ui.js';
import { loadLock, lock, lockEnabled, showLockScreen } from './lock.js';
import { renderStart } from './start.js';
import { renderFiles } from './files.js';
import { renderSearch, renderUpload } from './views.js';
import { renderWelcome, renderMore } from './more.js';
import { isUploading, onQueue, stats } from './upload.js';
import { APP_VERSION } from './version.js';

const NAV = [
  ['start', 'Übersicht', 'home'],
  ['dateien', 'Dateien', 'folder'],
  ['suche', 'Suche', 'search'],
  ['hochladen', 'Hochladen', 'upload'],
  ['mehr', 'Mehr', 'more'],
];

const root = document.getElementById('app');
let view = null;
let navEls = [];
let syncBadge = null;

function shell() {
  clear(root);
  syncBadge = h('div.syncstate');
  const side = h('nav.side', h('div.brand', h('img', { src: 'icons/icon-192.png', alt: '' }), h('span', 'Orbit NAS')),
    NAV.map(([id, label, ic]) => h('a.nav', { href: '#/' + id, 'data-id': id }, icon(ic), h('span', label))), syncBadge);
  const tabs = h('nav.tabs', NAV.map(([id, label, ic]) => h('a.tab', { href: '#/' + id, 'data-id': id }, icon(ic), h('span', label))));
  view = h('main.view', { id: 'view' });
  root.append(h('div.shell', side, view, tabs));
  navEls = [...root.querySelectorAll('[data-id]')];
  paintSync();
}

function paintSync() {
  if (!syncBadge) return;
  const up = stats();
  clear(syncBadge).append(
    state.syncing ? h('span', icon('sync', 'spin'), ' Gleiche ab …')
      : !state.online ? h('span.warn', icon('cloud'), ' Offline')
        : state.syncError ? h('span.warn', icon('warn'), ' ' + state.syncError.message)
          : h('span', icon('check'), ' Abgeglichen'),
    up.active ? h('span', icon('upload'), ` ${up.active} am Hochladen`) : null,
    h('small', 'Version ' + APP_VERSION));
  // kleiner Punkt am Tab „Hochladen“
  root.querySelectorAll('[data-id=hochladen]').forEach((el) => el.classList.toggle('badge', up.active > 0));
}

let rendering = 0;
async function render() {
  if (!state.pairing) { renderWelcome(root); view = null; return; }
  if (!view || !document.body.contains(view)) shell();
  const { parts } = route();
  const page = parts[0] || 'start';
  navEls.forEach((el) => el.classList.toggle('on', el.dataset.id === page));
  const my = ++rendering;
  view.scrollTop = 0;
  try {
    if (page === 'start') await renderStart(view);
    else if (page === 'dateien') await renderFiles(view, parts);
    else if (page === 'suche') await renderSearch(view);
    else if (page === 'hochladen') await renderUpload(view);
    else if (page === 'mehr') await renderMore(view, parts);
    else go('#/start');
  } catch (e) {
    console.error(e);
    if (my === rendering) clear(view).append(h('div.empty', icon('warn', 'big'), h('p', e.message || String(e))));
  }
}

// ---------------------------------------------------------------- Abgleich im Hintergrund

let timer = null;
async function backgroundSync(force = false) {
  if (!state.pairing || document.visibilityState !== 'visible') return;
  try { await sync({ force }); } catch { /* wird angezeigt */ }
}
function schedule() {
  clearTimeout(timer);
  const ms = openJobs().length ? 15000 : 60000;
  timer = setTimeout(async () => { await backgroundSync(); schedule(); }, ms);
}

let refreshPending = false;
onChange((what) => {
  paintSync();
  // Startseite bei neuen Daten aktualisieren (andere Seiten nicht, damit nichts unter dem Finger springt)
  if (what === 'pairing') { view = null; render(); return; }
  if ((what === 'jobs' || (what === 'sync' && !state.syncing)) && (route().parts[0] || 'start') === 'start' && !document.querySelector('.backdrop')) {
    if (!refreshPending) { refreshPending = true; setTimeout(() => { refreshPending = false; if ((route().parts[0] || 'start') === 'start') render(); }, 300); }
  }
});
onQueue(paintSync);

// ---------------------------------------------------------------- Sperre beim Zurückkehren

let hiddenAt = null;
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
  if (hiddenAt && lockEnabled() && Date.now() - hiddenAt >= (lock.autoLockMin ?? 2) * 60000) {
    unlocked.clear();
    await showLockScreen();
  }
  hiddenAt = null;
  backgroundSync();
  checkUpdate();
});
window.addEventListener('online', () => { state.online = true; backgroundSync(); });
window.addEventListener('offline', () => { state.online = false; paintSync(); });

// ---------------------------------------------------------------- Updates (Service Worker)

let reg = null;
async function registerSw() {
  if (!('serviceWorker' in navigator)) return;
  try {
    reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      if (isUploading()) { toast('Neue Version ist bereit – sie startet nach dem Hochladen.'); return; }
      location.reload();
    });
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw && nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller && !isUploading()) nw.postMessage('skipWaiting');
      });
    });
    if (reg.waiting && !isUploading()) reg.waiting.postMessage('skipWaiting');
  } catch (e) { console.warn('Offline-Modus nicht verfügbar', e); }
}
function checkUpdate() { if (reg) reg.update().catch(() => {}); }

// ---------------------------------------------------------------- Start

window.addEventListener('hashchange', render);
let lastWide = isWide();
window.addEventListener('resize', () => {
  // Beim Drehen des iPads zwischen Handy- und Tablet-Aufteilung umschalten
  const w = isWide();
  if (w !== lastWide) { lastWide = w; document.documentElement.classList.toggle('wide', w); }
});

(async function boot() {
  document.documentElement.classList.toggle('wide', isWide());
  await loadSettings();
  await loadLock();
  const paired = await init();
  persist();
  registerSw();
  document.getElementById('splash')?.remove();
  if (paired && lockEnabled()) await showLockScreen();
  await render();
  if (paired) { backgroundSync(true); schedule(); }
  onChange((w) => { if (w === 'pairing' && state.pairing) { backgroundSync(true); schedule(); } });
})();
