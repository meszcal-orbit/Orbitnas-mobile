// Suche über alles: pCloud, die Dateiliste des PCs (Speicher, FRITZ!NAS …) und die Funktionen der App.

import { state, basePath, pcloudLocationId, isHidden } from './sync.js';
import { cache } from './db.js';
import { norm, kindOf } from './util.js';

let pcTree = null;     // { built, items }
let building = null;

export async function loadPcTree() {
  if (!pcTree) pcTree = (await cache.get('pctree')) || null;
  return pcTree;
}

/** Liest alle Ordner in pCloud einmal komplett ein (ohne den Sicherungsordner, der steht in der PC-Liste). */
export function buildPcTree(onProgress) {
  if (building) return building;
  building = (async () => {
    const root = await state.backend.list('/');
    const items = [];
    const base = basePath().toLowerCase();
    const folders = root.items.filter((x) => x.isFolder);
    items.push(...root.items);
    let n = 0;
    for (const f of folders) {
      onProgress && onProgress(++n, folders.length, f.name);
      if (f.path.toLowerCase() === base) continue;
      items.push(...await state.backend.tree(f.folderid, f.path));
    }
    pcTree = { built: new Date().toISOString(), items: items.map((x) => ({ ...x, _n: norm(x.name) })) };
    await cache.set('pctree', pcTree);
    return pcTree;
  })().finally(() => { building = null; });
  return building;
}

export const pcTreeAge = () => (pcTree ? Date.now() - Date.parse(pcTree.built) : Infinity);

const normCache = new WeakMap();
function normsOf(loc) {
  if (!normCache.has(loc)) normCache.set(loc, loc.e.map((x) => norm(x[1])));
  return normCache.get(loc);
}

/**
 * Sucht. filter: 'alle' | 'bild' | 'video' | 'dokument' | 'ordner'. Liefert bis zu `limit` Treffer.
 * Mehrere Wörter müssen alle vorkommen.
 */
export function search(query, { filter = 'alle', limit = 400, showHidden = false } = {}) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return { results: [], more: false };
  const results = [];
  const match = (n) => words.every((w) => n.includes(w));
  const kindOk = (name, isFolder) => {
    if (filter === 'alle') return true;
    const k = kindOf(name, isFolder);
    if (filter === 'dokument') return k === 'dokument' || k === 'pdf';
    return k === filter;
  };
  let more = false;

  // pCloud
  if (pcTree) {
    const loc = pcloudLocationId();
    for (const it of pcTree.items) {
      if (!match(it._n) || !kindOk(it.name, it.isFolder)) continue;
      if (!showHidden && isHidden(loc, it.path)) continue;
      if (results.length >= limit) { more = true; break; }
      results.push({ ...it, source: 'pcloud', location: loc, locationName: 'pCloud' });
    }
  }
  // Orte des PCs
  for (const loc of state.index) {
    const ns = normsOf(loc);
    for (let i = 0; i < ns.length; i++) {
      if (!match(ns[i])) continue;
      const x = loc.e[i];
      if (!kindOk(x[1], !!(x[2] & 1))) continue;
      if (!showHidden && (x[2] & 2)) continue;
      if (results.length >= limit) { more = true; break; }
      results.push({ ...loc.item(i), source: 'index', locationName: loc.name });
    }
  }
  results.sort((a, b) => (b.isFolder - a.isFolder) || (b.mtime - a.mtime));
  return { results, more };
}

// Funktionen der App, die man über die Suche findet
export const FEATURES = [
  { words: 'pin passwort sperre sicherheit face id entsperren', label: 'Sperre & Face ID', go: '#/mehr/sicherheit', icon: 'lock' },
  { words: 'koppeln pc qr code verbinden neu', label: 'Mit PC koppeln', go: '#/mehr/kopplung', icon: 'link' },
  { words: 'hochladen upload fotos videos mediathek bilder', label: 'Fotos & Videos hochladen', go: '#/hochladen', icon: 'upload' },
  { words: 'sichern sicherung backup jetzt', label: 'Jetzt sichern (PC)', go: '#/start', icon: 'shield' },
  { words: 'speicher platz voll analyse groesse', label: 'Speicher-Übersicht', go: '#/start', icon: 'chart' },
  { words: 'export pdf excel liste drucken', label: 'Liste als PDF/Excel exportieren', go: '#/dateien', icon: 'export' },
  { words: 'auftraege status pc ergebnis', label: 'Aufträge an den PC', go: '#/mehr/auftraege', icon: 'task' },
  { words: 'design hell dunkel farbe aussehen', label: 'Aussehen', go: '#/mehr/aussehen', icon: 'eye' },
  { words: 'daten sichern wiederherstellen backup handy fritz nas', label: 'Handy-Daten sichern', go: '#/mehr/daten', icon: 'download' },
  { words: 'update version aktualisieren neu', label: 'Nach Update suchen', go: '#/mehr/info', icon: 'sync' },
  { words: 'versteckt verstecken anzeigen ausblenden', label: 'Versteckte Dateien zeigen', go: '#/mehr/aussehen', icon: 'eyeOff' },
  { words: 'favoriten stern', label: 'Favoriten', go: '#/start', icon: 'star' },
  { words: 'hilfe anleitung fragen', label: 'Hilfe', go: '#/mehr/hilfe', icon: 'info' },
];
export function searchFeatures(query) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return FEATURES.filter((f) => words.every((w) => norm(f.words + ' ' + f.label).includes(w)));
}
