// Abgleich mit dem PC und den anderen Handys über den verschlüsselten Ordner .mobil in pCloud.

import { kv, cache } from './db.js';
import { PCloud } from './pcloud.js';
import { DemoBackend, demoStatus, demoIndex, DEMO_PAIRING } from './demo.js';
import { encryptOnm, decryptOnm, b64urlToBytes } from './crypto.js';
import { uid } from './util.js';

export function deviceName() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  return 'Browser';
}

// ---------------------------------------------------------------- Dateiliste des PCs (index.onm)

export class LocIndex {
  constructor(loc) {
    this.id = loc.id;
    this.name = loc.name;
    this.kind = loc.kind;
    this.e = loc.e || [];
    this._kids = null;
    this._sizes = null;
  }
  kids() {
    if (!this._kids) {
      const k = new Map();
      this.e.forEach((x, i) => { if (!k.has(x[0])) k.set(x[0], []); k.get(x[0]).push(i); });
      this._kids = k;
    }
    return this._kids;
  }
  children(parent) { return this.kids().get(parent) || []; }
  pathOf(i) {
    const parts = [];
    while (i >= 0) { parts.unshift(this.e[i][1]); i = this.e[i][0]; }
    return parts.join('/');
  }
  find(path) {
    if (!path) return -1;
    let cur = -1;
    for (const part of path.split('/')) {
      const next = this.children(cur).find((i) => this.e[i][1] === part);
      if (next === undefined) return null;
      cur = next;
    }
    return cur;
  }
  /** Größe aller Ordner (Summe der Inhalte), einmal berechnet. */
  sizes() {
    if (!this._sizes) {
      const s = new Float64Array(this.e.length);
      for (let i = this.e.length - 1; i >= 0; i--) {
        const x = this.e[i];
        if (!(x[2] & 1)) s[i] = x[3];
        if (x[0] >= 0) s[x[0]] += s[i];
      }
      this._sizes = s;
    }
    return this._sizes;
  }
  item(i) {
    const x = this.e[i];
    const isFolder = !!(x[2] & 1);
    return {
      idx: i, name: x[1], isFolder, size: isFolder ? this.sizes()[i] : x[3], mtime: x[4] * 1000,
      hidden: !!(x[2] & 2), offloaded: !!(x[2] & 4), backedUp: !!(x[2] & 8), path: this.pathOf(i), location: this.id,
    };
  }
}

// ---------------------------------------------------------------- Zentrale Daten der App

const listeners = new Set();
export const state = {
  pairing: null,
  backend: null,
  status: null,
  index: [],          // LocIndex[]
  handy: { v: 1, uploads: {}, favs: {}, lastFolder: null },
  jobs: [],           // eigene Aufträge mit Ergebnis
  lastSync: null,
  syncing: false,
  syncError: null,
  online: navigator.onLine,
};

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(what) { for (const fn of listeners) { try { fn(what); } catch (e) { console.error(e); } } }

const mobilDir = () => '/' + state.pairing.base.replace(/^\/+|\/+$/g, '') + '/.mobil';
export const basePath = () => '/' + (state.pairing?.base || 'OrbitNAS').replace(/^\/+|\/+$/g, '');
export const isDemo = () => !!state.pairing?.demo;

function keyBytes() { return b64urlToBytes(state.pairing.key); }

export async function readOnm(relPath, aad) {
  const bytes = await state.backend.readFile(mobilDir() + '/' + relPath);
  if (!bytes) return null;
  return decryptOnm(keyBytes(), aad, bytes);
}
export async function writeOnm(relPath, aad, obj) {
  const full = mobilDir() + '/' + relPath;
  const folder = full.slice(0, full.lastIndexOf('/'));
  const name = full.slice(full.lastIndexOf('/') + 1);
  await state.backend.writeFile(folder, name, await encryptOnm(keyBytes(), aad, obj));
}

function setIndex(idx) {
  state.index = (idx?.locations || []).map((l) => new LocIndex(l));
  state.indexGenerated = idx?.generated || null;
}

/** Beim Start: gespeicherte Kopplung und zuletzt bekannte Daten laden (geht auch offline). */
export async function init() {
  state.pairing = (await kv.get('pairing')) || null;
  state.handy = (await kv.get('handy')) || state.handy;
  state.jobs = (await kv.get('jobs')) || [];
  if (!state.pairing) return false;
  makeBackend();
  if (isDemo()) {
    state.status = demoStatus();
    setIndex(demoIndex());
  } else {
    state.status = (await cache.get('status')) || null;
    setIndex(await cache.get('index'));
  }
  state.lastSync = (await kv.get('lastSync')) || null;
  return true;
}

function makeBackend() {
  state.backend = state.pairing.demo ? new DemoBackend() : new PCloud({ host: state.pairing.host, token: state.pairing.token });
}

/** Liest den QR-Code-Text vom PC. Wirft einen verständlichen Fehler, wenn er nicht passt. */
export function parsePairing(text) {
  text = (text || '').trim();
  const m = text.match(/ORBITNAS1:([A-Za-z0-9_-]+)/);
  if (!m) throw new Error('Das ist kein Kopplungs-Code von Orbit NAS.');
  let p;
  try { p = JSON.parse(new TextDecoder().decode(b64urlToBytes(m[1]))); } catch { throw new Error('Der Code ist unvollständig. Bitte noch einmal scannen.'); }
  if (p.v !== 1) throw new Error('Dieser Code ist von einer neueren PC-Version. Bitte die App neu laden (Mehr → Nach Update suchen).');
  if (!p.token || !p.key || !p.base) throw new Error('Der Code ist unvollständig. Bitte noch einmal scannen.');
  if (b64urlToBytes(p.key).length !== 32) throw new Error('Der Code ist beschädigt.');
  return { v: 1, pc: p.pc || 'PC', conn: p.conn || 'pcloud', host: p.host || 'api.pcloud.com', token: p.token, base: p.base, key: p.key, paired: new Date().toISOString() };
}

export async function pair(pairing) {
  state.pairing = pairing;
  makeBackend();
  // Zugang prüfen, bevor gespeichert wird.
  await state.backend.userinfo();
  await kv.set('pairing', pairing);
  await sync({ force: true });
  emit('pairing');
}

export async function startDemo() {
  state.pairing = { ...DEMO_PAIRING, paired: new Date().toISOString() };
  await kv.set('pairing', state.pairing);
  await init();
  emit('pairing');
}

/** Entkoppeln: löscht nur Zugang und zwischengespeicherte Daten dieses Geräts, nichts in der Cloud. */
export async function unpair() {
  await kv.del('pairing');
  await kv.del('lastSync');
  await cache.clear();
  state.pairing = null;
  state.backend = null;
  state.status = null;
  state.index = [];
  emit('pairing');
}

// ---------------------------------------------------------------- Abgleich

let syncPromise = null;
export function sync(opts = {}) {
  if (!syncPromise) syncPromise = doSync(opts).finally(() => { syncPromise = null; });
  return syncPromise;
}

async function doSync({ force = false } = {}) {
  if (!state.pairing) return;
  state.syncing = true;
  emit('sync');
  try {
    if (isDemo()) {
      state.status = demoStatus();
      await mergeHandy(null);
      await pollResultsDemo();
    } else {
      const files = await state.backend.listNames(mobilDir());
      const stamp = (n) => files.find((f) => f.name === n)?.mtime || 0;
      const seen = (await kv.get('seenStamps')) || {};

      if (force || stamp('status.onm') !== seen.status || !state.status) {
        const st = await readOnm('status.onm', 'status');
        if (st) { state.status = st; await cache.set('status', st); seen.status = stamp('status.onm'); }
      }
      if (force || stamp('index.onm') !== seen.index || !state.index.length) {
        const idx = await readOnm('index.onm', 'index');
        if (idx) { setIndex(idx); await cache.set('index', idx); seen.index = stamp('index.onm'); }
      }
      const remoteHandy = stamp('handy.onm') !== seen.handy || force || state.handyDirty ? await readOnm('handy.onm', 'handy') : null;
      const wrote = await mergeHandy(remoteHandy);
      if (wrote) {
        const after = await state.backend.listNames(mobilDir());
        seen.handy = after.find((f) => f.name === 'handy.onm')?.mtime || 0;
      } else seen.handy = stamp('handy.onm');
      await kv.set('seenStamps', seen);
      await pollResults();
    }
    state.lastSync = new Date().toISOString();
    state.syncError = null;
    state.online = true;
    await kv.set('lastSync', state.lastSync);
  } catch (e) {
    state.syncError = e;
    if (e.offline) state.online = false;
    throw e;
  } finally {
    state.syncing = false;
    emit('sync');
  }
}

// ---------------------------------------------------------------- Gemeinsame Handy-Daten (Upload-Register usw.)

function mergeInto(base, other) {
  if (!other) return base;
  const out = { v: 1, uploads: { ...(other.uploads || {}) }, favs: { ...(other.favs || {}) }, lastFolder: other.lastFolder || null };
  for (const [k, f] of Object.entries(base.favs || {})) if (!out.favs[k] || f.t > out.favs[k].t) out.favs[k] = f;
  for (const [fp, u] of Object.entries(base.uploads || {})) {
    const o = out.uploads[fp];
    if (!o || (u.t && o.t && u.t < o.t)) out.uploads[fp] = u;
  }
  if (base.lastFolder && (!out.lastFolder || base.lastFolder.t > out.lastFolder.t)) out.lastFolder = base.lastFolder;
  return out;
}

async function mergeHandy(remote) {
  const dirty = !!(await kv.get('handyDirty'));
  state.handy = mergeInto(state.handy, remote);
  await kv.set('handy', state.handy);
  if (dirty && !isDemo()) {
    await writeOnm('handy.onm', 'handy', { ...state.handy, updated: new Date().toISOString(), device: deviceName() });
  }
  if (dirty) await kv.set('handyDirty', false);
  state.handyDirty = false;
  emit('handy');
  return dirty && !isDemo();
}

export async function updateHandy(fn) {
  fn(state.handy);
  await kv.set('handy', state.handy);
  await kv.set('handyDirty', true);
  state.handyDirty = true;
  emit('handy');
}

// ---------------------------------------------------------------- Aufträge an den PC

export async function sendJob(type, args, label) {
  const job = { v: 1, id: uid(), created: new Date().toISOString(), device: deviceName(), type, args };
  if (!isDemo()) await writeOnm('auftraege/' + job.id + '.onm', 'auftrag', job);
  state.jobs.unshift({ id: job.id, type, args, label, created: job.created, state: 'gesendet', message: 'Wartet auf den PC …' });
  state.jobs = state.jobs.slice(0, 40);
  await kv.set('jobs', state.jobs);
  emit('jobs');
  return job.id;
}

export const openJobs = () => state.jobs.filter((j) => j.state === 'gesendet' || j.state === 'laeuft');

async function pollResults() {
  if (!openJobs().length) return;
  const files = await state.backend.listNames(mobilDir() + '/ergebnisse');
  let changed = false;
  for (const j of openJobs()) {
    const f = files.find((x) => x.name === j.id + '.onm');
    if (!f || f.mtime === j.resultStamp) continue;
    const r = await readOnm('ergebnisse/' + f.name, 'ergebnis');
    if (!r) continue;
    Object.assign(j, { state: r.state, progress: r.progress, message: r.message || '', pickup: r.pickup || null, updated: r.updated, resultStamp: f.mtime });
    changed = true;
  }
  if (changed) { await kv.set('jobs', state.jobs); emit('jobs'); }
}

async function pollResultsDemo() {
  let changed = false;
  for (const j of openJobs()) {
    const age = Date.now() - Date.parse(j.created);
    if (age > 8000) { j.state = 'fertig'; j.message = 'Erledigt (Beispiel).'; changed = true; }
    else if (age > 2000 && j.state !== 'laeuft') { j.state = 'laeuft'; j.progress = 0.5; j.message = 'Läuft am PC … (Beispiel)'; changed = true; }
  }
  if (changed) { await kv.set('jobs', state.jobs); emit('jobs'); }
}

export async function clearFinishedJobs() {
  state.jobs = openJobs();
  await kv.set('jobs', state.jobs);
  emit('jobs');
}

// ---------------------------------------------------------------- Hilfen für Orte, Schutz und Verstecktes

export function pcloudLocationId() { return state.pairing?.conn || 'pcloud'; }

/** Liegt ein pCloud-Pfad im Sicherungsbereich des PCs? Dort ändert das Handy nichts direkt. */
export function isProtectedPcloud(path) {
  const b = basePath().toLowerCase();
  const p = path.toLowerCase();
  return p === b || p.startsWith(b + '/');
}

export function isHidden(locationId, relPath) {
  const list = state.status?.hidden?.[locationId] || [];
  const p = relPath.replace(/^\/+/, '');
  return list.some((h) => { const x = h.replace(/\\/g, '/').replace(/^\/+/, ''); return p === x || p.startsWith(x + '/'); });
}

/** Ordner-PIN, die für diesen Pfad gilt (der spezifischste Treffer), oder null. */
export function lockFor(locationId, relPath) {
  const p = relPath.replace(/^\/+/, '');
  let best = null;
  for (const l of state.status?.locks || []) {
    if (l.location !== locationId) continue;
    const x = (l.path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (x === '' || p === x || p.startsWith(x + '/')) if (!best || x.length > best.path.length) best = { ...l, path: x };
  }
  return best;
}

export function managedFolderFor(relPath) {
  const p = relPath.replace(/^\/+/, '').toLowerCase();
  return (state.status?.folders || []).find((f) => f.path.replace(/\\/g, '/').toLowerCase() === p) || null;
}
