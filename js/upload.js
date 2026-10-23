// Warteschlange zum Hochladen nach pCloud mit Doppelt-Schutz und automatischem Weitermachen.

import { state, updateHandy, deviceName } from './sync.js';
import { fingerprint } from './crypto.js';
import { uid, fmtDate, sleep } from './util.js';

export const queue = [];
const listeners = new Set();
export const onQueue = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => fn());

let running = false;
let current = null;

/**
 * Dateien in die Warteschlange. targetPath = Ordner in pCloud. after(item): wird nach dem Hochladen aufgerufen
 * (z. B. Auftrag an den PC, die Datei aus dem Eingang auf den Speicher zu verschieben). label = Zielname für die Anzeige.
 */
export function addFiles(files, targetPath, { force = false, after = null, label = null } = {}) {
  for (const file of files) {
    queue.push({ id: uid(), file, name: file.name || 'Datei', targetPath, label: label || targetPath, after, status: 'wartet', loaded: 0, total: file.size, force, state: {}, tries: 0 });
  }
  emit();
  run();
}

export function stats() {
  const s = { total: queue.length, done: 0, skipped: 0, failed: 0, active: 0, bytes: 0, loaded: 0 };
  for (const q of queue) {
    if (q.status === 'fertig') s.done++;
    else if (q.status === 'übersprungen') s.skipped++;
    else if (q.status === 'fehler') s.failed++;
    else s.active++;
    if (q.status !== 'übersprungen') { s.bytes += q.total; s.loaded += q.status === 'fertig' ? q.total : q.loaded; }
  }
  return s;
}

export function clearFinished() {
  for (let i = queue.length - 1; i >= 0; i--) if (['fertig', 'übersprungen'].includes(queue[i].status)) queue.splice(i, 1);
  emit();
}

export function cancel(item) {
  if (item === current && item.abort) item.abort.abort();
  const i = queue.indexOf(item);
  if (i >= 0 && item !== current) queue.splice(i, 1);
  item.status = 'fehler';
  item.message = 'Abgebrochen';
  emit();
}

export function retry(item, force = false) {
  item.status = 'wartet';
  item.message = '';
  item.tries = 0;
  if (force) item.force = true;
  emit();
  run();
}

const folderCache = new Map();
async function folderInfo(path) {
  if (!folderCache.has(path)) {
    await state.backend.mkdir(path).catch(() => {});
    const list = await state.backend.list(path);
    folderCache.set(path, list);
  }
  return folderCache.get(path);
}

function uniqueName(name, taken) {
  if (!taken.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const c = `${base} (${n})${ext}`;
    if (!taken.has(c.toLowerCase())) return c;
  }
}

async function run() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      if (document.visibilityState === 'hidden') { await waitVisible(); continue; }
      const item = queue.find((q) => q.status === 'wartet' || q.status === 'pausiert');
      if (!item) break;
      current = item;
      await process(item);
      current = null;
      emit();
    }
  } finally {
    running = false;
    folderCache.clear();
    emit();
  }
}

async function process(item) {
  try {
    item.status = 'prüfe';
    emit();
    if (!item.fp) item.fp = await fingerprint(item.file);
    const known = state.handy.uploads?.[item.fp];
    if (known && !item.force) {
      item.status = 'übersprungen';
      item.message = `Schon hochgeladen am ${fmtDate(known.t, false)} nach ${known.p}` + (known.d ? ` (von ${known.d})` : '');
      return;
    }
    const folder = await folderInfo(item.targetPath);
    const same = folder.items.find((x) => !x.isFolder && x.name.toLowerCase() === item.name.toLowerCase());
    if (same && same.size === item.file.size && !item.force) {
      item.status = 'übersprungen';
      item.message = 'Liegt schon in diesem Ordner';
      await register(item, item.label);
      return;
    }
    if (!item.finalName) item.finalName = uniqueName(item.name, new Set(folder.items.map((x) => x.name.toLowerCase())));
    item.status = 'läuft';
    item.abort = new AbortController();
    emit();
    let lastEmit = 0;
    const meta = await state.backend.upload(item.file, folder.folderid, item.finalName, {
      signal: item.abort.signal,
      state: item.state,
      onProgress: (loaded) => {
        item.loaded = loaded;
        if (Date.now() - lastEmit > 250) { lastEmit = Date.now(); emit(); }
      },
    });
    item.loaded = item.total;
    item.status = 'fertig';
    item.message = item.finalName !== item.name ? `Gespeichert als „${item.finalName}“` : '';
    folder.items.push({ name: item.finalName, isFolder: false, size: item.file.size, ...(meta || {}) });
    await register(item, item.label);
    if (item.after) { try { await item.after(item); } catch (e) { item.message = 'Hochgeladen, aber: ' + e.message; } }
  } catch (e) {
    if (e.name === 'AbortError' && item.message === 'Abgebrochen') return;
    item.tries++;
    if ((e.offline || e.name === 'AbortError' || document.visibilityState === 'hidden') && item.tries < 30) {
      // Verbindung weg oder App im Hintergrund: warten und an derselben Stelle weitermachen.
      item.status = 'pausiert';
      item.message = 'Wartet auf Verbindung …';
      emit();
      await waitOnline();
      await sleep(Math.min(30000, 1000 * item.tries));
    } else if (e.code === 4000 && item.tries < 10) {
      item.status = 'pausiert';
      await sleep(5000 * item.tries);
    } else {
      item.status = 'fehler';
      item.message = e.message || String(e);
    }
  }
}

async function register(item, path) {
  await updateHandy((hd) => {
    hd.uploads = hd.uploads || {};
    hd.uploads[item.fp] = { n: item.finalName || item.name, p: path, s: item.file.size, t: new Date().toISOString(), d: deviceName() };
  });
}

function waitVisible() {
  return new Promise((r) => {
    const f = () => { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', f); r(); } };
    document.addEventListener('visibilitychange', f);
  });
}
function waitOnline() {
  if (navigator.onLine && document.visibilityState === 'visible') return Promise.resolve();
  return new Promise((r) => {
    const f = () => {
      if (navigator.onLine && document.visibilityState === 'visible') {
        window.removeEventListener('online', f);
        document.removeEventListener('visibilitychange', f);
        r();
      }
    };
    window.addEventListener('online', f);
    document.addEventListener('visibilitychange', f);
  });
}

export const isUploading = () => queue.some((q) => ['wartet', 'prüfe', 'läuft', 'pausiert'].includes(q.status));
