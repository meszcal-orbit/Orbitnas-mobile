// Gemeinsame Oberflächen-Einstellungen und Navigation.

import { kv } from './db.js';
import { applyDesign } from './theme.js';

export const settings = {
  designFromPc: true, theme: 'Orbit', accent: null,   // eigenes Design nur, wenn designFromPc = false
  tileView: false, sort: { by: 'name', dir: 1 }, showHidden: false, lastLocation: null, treeOpen: true, onlyProblems: false,
};
export async function loadSettings() { Object.assign(settings, (await kv.get('settings')) || {}); }
export const saveSettings = () => kv.set('settings', JSON.parse(JSON.stringify(settings)));

/** Design anwenden: wie am PC (aus status.onm) oder eigenes. */
export function applyTheme(status) {
  const d = status?.design;
  if (settings.designFromPc && d) applyDesign(d.theme, d.accent);
  else applyDesign(settings.theme, settings.accent);
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
export const isLandscapeWide = () => matchMedia('(min-width: 1000px)').matches;
export const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
