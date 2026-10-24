// Oberflächen-Einstellungen dieses Geräts (Ansicht, Sortierung) und Navigation.

import { kv } from './db.js';
import { applyDesign } from './theme.js';
import { design } from './store.js';

export const settings = { theme: 'Orbit', accent: null, tileView: false, sort: { by: 'name', dir: 1 }, showHidden: false };
export async function loadSettings() { Object.assign(settings, (await kv.get('settings3')) || {}); }
export const saveSettings = () => kv.set('settings3', JSON.parse(JSON.stringify(settings)));

/** Design wie am PC (aus der Einstellungsdatei); ohne Datei das zuletzt hier gewählte. */
export function applyTheme() {
  const d = design();
  if (d) applyDesign(d.theme, d.accent);
  else applyDesign(settings.theme, settings.accent);
}

export function go(hash, { replace = false } = {}) {
  if (replace) { history.replaceState(null, '', hash); window.dispatchEvent(new HashChangeEvent('hashchange')); return; }
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

/** "#/d/abc/Fotos%2FUrlaub" → { parts: ['d', 'abc', 'Fotos/Urlaub'] } */
export function route() {
  const [p, q] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = p.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  return { parts, query: new URLSearchParams(q || '') };
}
/** Adresse eines Ordners. path: "/" oder "/Fotos/Urlaub". */
export const dirHash = (connId, path = '/') => '#/d/' + encodeURIComponent(connId) + (path && path !== '/' ? '/' + encodeURIComponent(path.replace(/^\/+/, '')) : '');

/** In dieser Sitzung mit Ordner-PIN entsperrte Bereiche (werden beim Sperren der App vergessen). */
export const unlocked = new Set();

export const isWide = () => matchMedia('(min-width: 768px)').matches;
export const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
