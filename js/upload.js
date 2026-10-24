// Warteschlange zum Hochladen in eine Cloud: Doppelt-Schutz, Namensregel „Name (2).jpg“, Weitermachen nach Unterbrechung.
// Gleiche Datei schon im Zielordner (gleiche Größe und Prüfsumme) → still überspringen; anderer Inhalt → neuer Name.

import { kv } from './db.js';
import { source, connById } from './sources/registry.js';
import { uniqueName } from './sources/base.js';
import { dropboxHash } from './sources/dropbox.js';
import { fingerprint } from './crypto.js';
import { uid, fmtDate, sleep } from './util.js';

export const queue = [];
const listeners = new Set();
export const onQueue = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => fn());

let running = false;
let current = null;
let known = null;
async function registry() { if (!known) known = (await kv.get('uploads')) || {}; return known; }

/**
 * Dateien hochladen. files: File[] oder [{ name, size, load: () => Promise<Blob> }] (z. B. beim Kopieren zwischen Clouds).
 * connId/folder: Ziel. after(item): nach dem Hochladen (z. B. Original löschen beim Verschieben).
 */
export function addFiles(files, connId, folder, { force = false, after = null, label = null, register = true } = {}) {
  for (const f of files) {
    queue.push({ id: uid(), file: f.load ? null : f, load: f.load || null, name: f.name || 'Datei', connId, folder, label: label || folder, after, register,
      status: 'wartet', loaded: 0, total: f.size || 0, force, state: {}, tries: 0 });
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
  for (let i = queue.length - 1; i >= 0; i--) if (['fertig', 'übersprungen', 'fehler'].includes(queue[i].status)) queue.splice(i, 1);
  emit();
}

export function cancel(item) {
  if (item === current && item.abort) item.abort.abort();
  item.status = 'fehler';
  item.message = 'Abgebrochen';
  emit();
}

export function retry(item, force = false) {
  Object.assign(item, { status: 'wartet', message: '', tries: 0 });
  if (force) item.force = true;
  emit();
  run();
}

const folders = new Map();
async function folderList(src, connId, path) {
  const k = connId + ':' + path;
  if (!folders.has(k)) folders.set(k, await src.list(path));
  return folders.get(k);
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
/** Gleicher Inhalt wie die Datei in der Cloud? Ohne Prüfsumme der Cloud (oder bei sehr großen Dateien) genügt die gleiche Größe. */
async function sameContent(src, file, remote) {
  if (!src.checksum || file.size > 300 * 1024 * 1024) return true;
  try {
    const c = await src.checksum(remote);
    if (!c?.hex) return true;
    if (c.algo === 'DROPBOX') return (await dropboxHash(file)) === c.hex;
    return hex(await crypto.subtle.digest(c.algo, await file.arrayBuffer())) === c.hex;
  } catch { return true; }
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
    folders.clear();
    emit();
  }
}

async function process(item) {
  try {
    item.status = 'prüfe';
    emit();
    const src = await source(item.connId);
    if (!item.file) { item.file = new File([await item.load()], item.name); item.total = item.file.size; }
    const reg = await registry();
    if (item.register && !item.fp) item.fp = await fingerprint(item.file);
    const seen = item.fp && reg[item.fp];
    if (seen && !item.force && seen.c === item.connId) {
      item.status = 'übersprungen';
      item.message = `Schon hochgeladen am ${fmtDate(seen.t, false)} nach ${seen.p}`;
      return;
    }
    const list = await folderList(src, item.connId, item.folder);
    const same = list.find((x) => !x.isFolder && x.name.toLowerCase() === item.name.toLowerCase());
    if (same && same.size === item.file.size && !item.force && await sameContent(src, item.file, same)) {
      item.status = 'übersprungen';
      item.message = 'Liegt schon in diesem Ordner (gleicher Inhalt)';
      await remember(item);
      if (item.after) await item.after(item).catch(() => {});
      return;
    }
    if (!item.finalName) item.finalName = uniqueName(item.name, new Set(list.map((x) => x.name.toLowerCase())));
    item.status = 'läuft';
    item.abort = new AbortController();
    emit();
    let last = 0;
    await src.upload(item.file, item.folder, item.finalName, {
      signal: item.abort.signal, state: item.state,
      onProgress: (n) => { item.loaded = n; if (Date.now() - last > 250) { last = Date.now(); emit(); } },
    });
    item.loaded = item.total;
    item.status = 'fertig';
    item.message = item.finalName !== item.name ? `Gespeichert als „${item.finalName}“` : '';
    list.push({ name: item.finalName, isFolder: false, size: item.file.size });
    await remember(item);
    if (item.load) item.file = null;   // Speicher freigeben
    if (item.after) { try { await item.after(item); } catch (e) { item.message = 'Hochgeladen, aber: ' + e.message; } }
  } catch (e) {
    if (e.name === 'AbortError' && item.message === 'Abgebrochen') return;
    item.tries++;
    if ((e.offline || e.name === 'AbortError' || document.visibilityState === 'hidden') && item.tries < 30) {
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
      item.message = e.message + (e.detail ? ` (${e.detail})` : '');
    }
  }
}

async function remember(item) {
  if (!item.fp) return;
  const reg = await registry();
  reg[item.fp] = { n: item.finalName || item.name, p: (connById(item.connId)?.name || '') + ' › ' + (item.folder === '/' ? '' : item.folder.slice(1).replace(/\//g, ' › ')), c: item.connId, t: new Date().toISOString() };
  await kv.set('uploads', reg);
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
      if (navigator.onLine && document.visibilityState === 'visible') { window.removeEventListener('online', f); document.removeEventListener('visibilitychange', f); r(); }
    };
    window.addEventListener('online', f);
    document.addEventListener('visibilitychange', f);
  });
}

export const isUploading = () => queue.some((q) => ['wartet', 'prüfe', 'läuft', 'pausiert'].includes(q.status));
