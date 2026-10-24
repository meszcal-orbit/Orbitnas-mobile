// Liste der eingebundenen Quellen (Clouds) auf diesem Gerät. Jede Quelle ist ein eigener Baustein (sources/*.js).
// Gespeichert: kv "connections" = [{ id, type, name, key, cfg }], Anmeldedaten getrennt und verschlüsselt (secrets.js).

import { kv } from '../db.js';
import { saveSecret, loadSecret, deleteSecret, loadOldPcloudLogin } from '../secrets.js';
import { uid } from '../util.js';

/** Anbieter, die im Browser wirklich gehen. Reihenfolge = Reihenfolge für die Haupt-Cloud (EINSTELLUNGEN.md). */
export const PROVIDERS = {
  pcloud: { name: 'pCloud', color: '#17BED0', load: () => import('./pcloud.js').then((m) => m.PCloudSource) },
  onedrive: { name: 'OneDrive', color: '#0F6CBD', load: () => import('./onedrive.js').then((m) => m.OneDriveSource) },
  gdrive: { name: 'Google Drive', color: '#1FA463', load: () => import('./gdrive.js').then((m) => m.GDriveSource) },
  dropbox: { name: 'Dropbox', color: '#0061FE', load: () => import('./dropbox.js').then((m) => m.DropboxSource) },
  demo: { name: 'Beispiel', color: '#A855F7', load: () => import('./demo.js').then((m) => m.DemoSource) },
};
export const ORDER = ['pcloud', 'onedrive', 'gdrive', 'dropbox'];

let conns = [];
const instances = new Map();
const listeners = new Set();
export const onConnections = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => fn(conns));

export async function loadConnections() {
  conns = (await kv.get('connections')) || [];
  // Umstieg von Version 2: vorhandene pCloud-Anmeldung übernehmen
  if (!conns.length && !(await kv.get('migrated3'))) {
    const old = await loadOldPcloudLogin();
    const pairing = await kv.get('pairing');
    if (old && !pairing?.demo) {
      const conn = { id: uid(), type: 'pcloud', name: 'pCloud', key: null, cfg: { host: pairing?.host || 'api.pcloud.com' } };
      await saveSecret(conn.id, old);
      conns.push(conn);
      await kv.set('connections', conns);
    }
    await kv.set('migrated3', true);
  }
  return conns;
}

export const connections = () => conns;
export const connById = (id) => conns.find((c) => c.id === id);
export const connByKey = (key) => conns.find((c) => c.key && c.key.toLowerCase() === (key || '').toLowerCase());
export const isDemo = () => conns.length > 0 && conns.every((c) => c.type === 'demo');

async function save() { await kv.set('connections', conns); emit(); }

/** Neue Quelle anlegen: Baustein prüfen lassen (Anmeldung), Kennung holen, speichern. */
export async function addConnection(type, cfg, secret) {
  const Cls = await PROVIDERS[type].load();
  const src = new Cls({ cfg }, secret);
  const me = await src.info();
  const existing = conns.find((c) => c.key && c.key === me.key);
  const conn = existing || { id: uid(), type, name: PROVIDERS[type].name, key: me.key, cfg };
  conn.cfg = { ...conn.cfg, ...cfg, ...(src.cfgUpdate || {}) };
  conn.email = me.email || '';
  if (!existing) {
    const same = conns.filter((c) => c.type === type).length;
    if (same) conn.name = `${PROVIDERS[type].name} (${me.email || same + 1})`;
    conns.push(conn);
  }
  await saveSecret(conn.id, src.secret ? src.secret() : secret);
  src.onSecret = (s) => saveSecret(conn.id, s);
  instances.set(conn.id, src);
  await save();
  return conn;
}

export async function removeConnection(id) {
  conns = conns.filter((c) => c.id !== id);
  instances.delete(id);
  await deleteSecret(id);
  await save();
}

export async function renameConnection(id, name) { const c = connById(id); if (c) { c.name = name; await save(); } }

/** Schon geladener Baustein (ohne Warten), sonst null. */
export const loadedSource = (id) => instances.get(id) || null;

/** Baustein einer Quelle (einmal erzeugt, dann wiederverwendet). */
export async function source(id) {
  if (instances.has(id)) return instances.get(id);
  const c = connById(id);
  if (!c) throw new Error('Diese Quelle gibt es nicht mehr.');
  const Cls = await PROVIDERS[c.type].load();
  const src = new Cls(c, await loadSecret(c.id));
  // Bausteine mit Zugangs-Schlüsseln (OAuth) melden neue Schlüssel, damit sie verschlüsselt gespeichert werden
  src.onSecret = (s) => saveSecret(c.id, s);
  instances.set(id, src);
  if (!c.key) {
    // z. B. nach dem Umstieg von Version 2: Kennung nachträglich holen
    src.info().then(async (me) => { c.key = me.key; c.email = me.email || c.email; await save(); }).catch(() => {});
  }
  return src;
}

/** Fehlende Kennungen holen (z. B. direkt nach dem Umstieg von Version 2), damit die Haupt-Cloud feststeht. */
export async function ensureKeys() {
  let changed = false;
  for (const c of conns.filter((x) => !x.key && x.type !== 'demo')) {
    try { const me = await (await source(c.id)).info(); c.key = me.key; c.email = me.email || c.email; changed = true; } catch { /* später nochmal */ }
  }
  if (changed) await save();
}

/** Neue Anmeldedaten für eine bestehende Quelle (z. B. Passwort geändert). */
export async function updateSecret(id, secret) {
  const c = connById(id);
  const Cls = await PROVIDERS[c.type].load();
  const src = new Cls(c, secret);
  const me = await src.info();
  c.key = me.key;
  if (src.cfgUpdate) c.cfg = { ...c.cfg, ...src.cfgUpdate };
  await saveSecret(id, src.secret ? src.secret() : secret);
  src.onSecret = (s) => saveSecret(c.id, s);
  instances.set(id, src);
  await save();
}

/** Haupt-Cloud für die Einstellungsdatei: pCloud, sonst die erste in der Reihenfolge; bei mehreren Konten nach Kennung. */
export function mainConnection() {
  const real = conns.filter((c) => c.key && ORDER.includes(c.type));
  real.sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || a.key.localeCompare(b.key));
  return real[0] || conns.find((c) => c.type === 'demo') || null;
}

export const colorOf = (c) => PROVIDERS[c?.type]?.color || '#94A3B8';
