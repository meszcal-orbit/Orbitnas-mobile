// Gemeinsame Oberflächen-Einstellungen und Navigation.

import { kv } from './db.js';

export const settings = { theme: 'auto', view: 'liste', sort: { by: 'name', dir: 1 }, showHidden: false, lastSource: null };
export async function loadSettings() { Object.assign(settings, (await kv.get('settings')) || {}); applyTheme(); }
export const saveSettings = () => kv.set('settings', JSON.parse(JSON.stringify(settings)));

export function applyTheme() {
  const t = settings.theme;
  document.documentElement.dataset.theme = t === 'auto' ? '' : t;
  const dark = t === 'orbit' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0A0A16' : '#F3F4F7');
}

export function go(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

/** Zerlegt "#/dateien/storage/Fotos%2FUrlaub" in ['dateien', 'storage', 'Fotos/Urlaub'] und Abfrage-Parameter. */
export function route() {
  const [p, q] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = p.split('/').filter(Boolean).map(decodeURIComponent);
  return { parts, query: new URLSearchParams(q || '') };
}
export const filesHash = (loc, path = '') => '#/dateien/' + encodeURIComponent(loc) + (path ? '/' + encodeURIComponent(path) : '');

/** In dieser Sitzung mit Ordner-PIN entsperrte Bereiche (werden beim Sperren der App vergessen). */
export const unlocked = new Set();

export const isWide = () => matchMedia('(min-width: 768px)').matches;
export const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
