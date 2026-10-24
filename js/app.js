// Start der App: Grundgerüst wie am PC (Leiste links am iPad, unten am iPhone), Sperre, Abgleich, Updates.

import { h, icon, toast, clear } from './util.js';
import { state, init, sync, onChange, openJobs } from './sync.js';
import { persist } from './db.js';
import { loadSettings, route, go, unlocked, isWide, isLandscapeWide, applyTheme } from './ui.js';
import { loadLock, lock, lockEnabled, showLockScreen } from './lock.js';
import { renderFiles } from './files.js';
import { renderBackup } from './backup.js';
import { renderLog } from './log.js';
import { renderSettings } from './settings.js';
import { renderWelcome, openLogin } from './pairing.js';
import { hasLogin } from './login.js';
import { isUploading } from './upload.js';
import { APP_VERSION } from './version.js';

// Dieselben Seiten wie am PC
const NAV = [
  ['dateien', 'Dateien', 'folder'],
  ['sicherung', 'Sicherung', 'shield'],
  ['protokoll', 'Protokoll', 'log'],
  ['einstellungen', 'Einstellungen', 'gear'],
];

const root = document.getElementById('app');
let view = null;
let navEls = [];
let rail = null;

function shell() {
  clear(root);
  const items = (cls) => NAV.map(([id, label, ic]) => h('a.' + cls, { href: '#/' + id, 'data-id': id }, h('span.ni', icon(ic)), h('span.nl', label)));
  rail = h('nav.rail',
    h('img.rail-logo', { src: 'icons/icon-192.png', alt: 'Orbit NAS' }),
    ...items('ritem'),
    h('div.rail-foot',
      lockEnabled() ? h('button.ritem.lockbtn', { title: 'Sperren', onclick: lockNow }, h('span.ni', icon('lock'))) : null,
      h('span.sdot', { title: '' }), h('span.ver', 'v' + APP_VERSION)));
  const tabs = h('nav.tabs', items('tab'));
  view = h('main.view', { id: 'view' });
  root.append(h('div.shell', rail, view, tabs));
  navEls = [...root.querySelectorAll('[data-id]')];
  paintSync();
}

function lockNow() { unlocked.clear(); showLockScreen(); }

function paintSync() {
  const dot = root.querySelector('.sdot');
  if (!dot) return;
  const tone = state.syncing ? 'accent' : !state.online ? 'warn' : state.syncError ? 'danger' : 'ok';
  dot.className = 'sdot ' + tone;
  dot.title = state.syncing ? 'Gleicht ab …' : !state.online ? 'Offline' : state.syncError ? state.syncError.message : 'Abgeglichen ' + (state.lastSync ? new Date(state.lastSync).toLocaleTimeString('de-DE') : '');
  const jobs = openJobs().length;
  root.querySelectorAll('[data-id=sicherung]').forEach((el) => el.classList.toggle('badge', jobs > 0 || !!state.status?.operations?.some((o) => o.status === 'Läuft')));
}

let rendering = 0;
async function render() {
  applyTheme(state.status);
  if (!state.pairing) { renderWelcome(root); view = null; return; }
  if (!view || !document.body.contains(view)) shell();
  const { parts } = route();
  const page = parts[0] || 'dateien';
  navEls.forEach((el) => el.classList.toggle('on', el.dataset.id === page));
  document.documentElement.dataset.page = page;
  const my = ++rendering;
  if (page !== 'dateien') view.scrollTop = 0;
  try {
    if (page === 'dateien') await renderFiles(view, parts);
    else if (page === 'sicherung') renderBackup(view);
    else if (page === 'protokoll') renderLog(view);
    else if (page === 'einstellungen') await renderSettings(view);
    else go('#/dateien');
  } catch (e) {
    console.error(e);
    if (my === rendering) clear(view).append(h('div.empty', icon('warn', 'big'), h('p', e.message || String(e))));
  }
}

// ---------------------------------------------------------------- Abgleich im Hintergrund

let timer = null;
let loginAsked = false;
async function backgroundSync(force = false) {
  if (!state.pairing || document.visibilityState !== 'visible') return;
  try { await sync({ force }); } catch (e) {
    if (e && e.code === 'LOGIN' && !loginAsked && !document.querySelector('.backdrop')) {
      loginAsked = true;
      if (await openLogin({ reason: e.message })) backgroundSync(true);
    }
  }
}
function schedule() {
  clearTimeout(timer);
  const ms = openJobs().length ? 10000 : 60000;
  timer = setTimeout(async () => { await backgroundSync(); schedule(); }, ms);
}

let refreshPending = false;
onChange((what) => {
  paintSync();
  if (what === 'pairing') { view = null; render(); if (state.pairing) { backgroundSync(true); schedule(); } return; }
  if (what === 'jobs') schedule();
  if (what === 'status' || what === 'sync') applyTheme(state.status);
  // Seiten mit Stand vom PC neu zeichnen, wenn neue Daten da sind (Dateien nicht, damit nichts unter dem Finger springt)
  const page = route().parts[0] || 'dateien';
  if (['sicherung', 'protokoll'].includes(page) && (what === 'jobs' || what === 'status' || (what === 'sync' && !state.syncing)) && !document.querySelector('.backdrop')) {
    if (!refreshPending) { refreshPending = true; setTimeout(() => { refreshPending = false; if (['sicherung', 'protokoll'].includes(route().parts[0])) render(); }, 300); }
  }
});

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

// ---------------------------------------------------------------- Updates (Service Worker) – Daten bleiben unberührt

let reg = null;
async function registerSw() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const hadController = !!navigator.serviceWorker.controller;
    reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Beim allerersten Start übernimmt der Service Worker nur – kein Neuladen, sonst geht z. B. das Koppeln-Fenster zu.
      if (reloading || !hadController) return;
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
let lastLayout = '';
function layout() {
  // Beim Drehen des iPads automatisch zwischen Handy-, Hochkant- und Quer-Aufteilung wechseln
  const l = isLandscapeWide() ? 'wide land' : isWide() ? 'wide' : 'narrow';
  if (l === lastLayout) return;
  const before = lastLayout;
  lastLayout = l;
  document.documentElement.classList.toggle('wide', isWide());
  document.documentElement.classList.toggle('land', isLandscapeWide());
  if (before && state.pairing && (route().parts[0] || 'dateien') === 'dateien') render();
}
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', () => setTimeout(layout, 300));

(async function boot() {
  layout();
  await loadSettings();
  await loadLock();
  const paired = await init();
  applyTheme(state.status);
  persist();
  registerSw();
  document.getElementById('splash')?.remove();
  if (paired && lockEnabled()) await showLockScreen();
  if (!location.hash || /^#\/(start|suche|hochladen|mehr)/.test(location.hash)) history.replaceState(null, '', '#/dateien');
  await render();
  // Ab 2.2 braucht das Lesen von Dateien die pCloud-Anmeldung (pCloud-Vorgabe für Web-Apps)
  if (paired && !state.pairing.demo && !(await hasLogin())) await openLogin({ reason: 'Neu in dieser Version: pCloud lässt die App Dateien nur mit deiner Anmeldung öffnen. Bitte einmal mit demselben Konto wie am PC anmelden.' });
  if (paired) { backgroundSync(true); schedule(); }
})();
