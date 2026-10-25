// Alles, was mit Dateien passiert: Ordnerlisten (mit Zwischenspeicher), Regeln aus der Einstellungsdatei
// (versteckt, ignoriert, schreibgeschützt, PIN, Farbe, Favoriten), Kopieren/Verschieben auch zwischen Clouds, Teilen.

import { h, icon, kindOf, kindIcon, KIND_COLOR, toast, confirmDialog, shareOrDownload, sheet } from './util.js';
import { cache, kv } from './db.js';
import { source, loadedSource, connById, connByKey, colorOf, connections } from './sources/registry.js';
import { relPath, joinPath, parentPath, baseName, uniqueName } from './sources/base.js';
import * as store from './store.js';
import { settings, unlocked } from './ui.js';
import { addFiles } from './upload.js';
import { typeIcon } from './typeicons.js';
import { startOp } from './opsbar.js';

export const SYSTEM = ['.orbitnas', '.mobil', '.versionen'];
export const FOLDER_ICON = { folder: 'folder', star: 'star', heart: 'heart', photo: 'image', music: 'music', video: 'video', doc: 'doc', work: 'work', home: 'home', lock: 'lock', cloud: 'cloud', archive: 'archive' };
export const FOLDER_COLORS = ['#F5B544', '#EF4444', '#F97316', '#EAB308', '#22C55E', '#14B8A6', '#0EA5E9', '#3B82F6', '#6366F1', '#A855F7', '#EC4899', '#94A3B8'];

export const keyOf = (connId) => connById(connId)?.key || '';
export const connName = (connId) => connById(connId)?.name || 'Quelle';
export const srcColor = (connId) => { const c = connById(connId); return (c?.key && store.sourceColor(c.key)) || colorOf(c); };

// ---------------------------------------------------------------- Regeln

export const isEncrypted = (path) => /(^|\/)\.verschluesselt(\/|$)/i.test(path);
export const isSystem = (it) => SYSTEM.includes(it.name.toLowerCase());
export const isIgnored = (connId, path) => !!store.entry('ignored', keyOf(connId), relPath(path));
export const isHidden = (connId, it) => !!store.entry('hidden', keyOf(connId), relPath(it.path)) || (it.name.startsWith('.') && !isEncrypted(it.path));
export const readOnlyFor = (connId, path) => store.inherited('readOnly', keyOf(connId), relPath(path));
export const lockFor = (connId, path) => { const l = store.inherited('locks', keyOf(connId), relPath(path)); return l?.hash ? l : null; };
export const isUnlocked = (connId, lk) => unlocked.has(keyOf(connId) + ':' + lk.path.toLowerCase());
export const markUnlocked = (connId, lk) => unlocked.add(keyOf(connId) + ':' + lk.path.toLowerCase());
export const folderStyle = (connId, path) => store.entry('folderStyles', keyOf(connId), relPath(path));
export const isFavorite = (connId, path) => !!store.entry('favorites', keyOf(connId), relPath(path));
export const writable = (connId, path) => !readOnlyFor(connId, path) && !isEncrypted(path);

/** Was im Ordner angezeigt wird: ohne Systemordner und Ignoriertes, Verstecktes nur mit „Versteckte zeigen“. */
export function visible(connId, items) {
  return items.filter((it) => !isSystem(it) && !isIgnored(connId, it.path) && (settings.showHidden || !isHidden(connId, it)));
}

// ---------------------------------------------------------------- Ordner laden (zuerst Zwischenspeicher, dann frisch)

export async function cachedList(connId, path) { const c = await cache.get('ls:' + connId + ':' + path.toLowerCase()); return c || null; }
export async function listFolder(connId, path) {
  const src = await source(connId);
  const items = (await src.list(path)).map((it) => ({ ...it, conn: connId }));
  cache.set('ls:' + connId + ':' + path.toLowerCase(), { items, at: Date.now() }).catch(() => {});
  return items;
}

// ---------------------------------------------------------------- Symbole und Vorschaubilder

export function glyph(it, big = false) {
  const cls = 'span.glyph' + (big ? '.big' : '');
  if (it.isFolder) {
    if (isEncrypted(it.path)) return h(cls, { style: { color: '#F59E0B' } }, icon('lock'));
    const lk = lockFor(it.conn, it.path);
    if (lk && lk.path.toLowerCase() === relPath(it.path).toLowerCase()) return h(cls, { style: { color: '#F59E0B' } }, icon('lock'));
    const st = it.style !== undefined ? it.style : folderStyle(it.conn, it.path);
    return h(cls, folderIcon(st));
  }
  return h(cls, typeIcon(kindOf(it.name), { filled: store.iconsFilled() }));
}

/** Ordnersymbol mit Farbe und Zeichen aus der Einstellungsdatei. */
export function folderIcon(st, cls = '') {
  return typeIcon('folder', { color: st?.color, mark: st?.icon ? FOLDER_ICON[st.icon] : null, filled: store.iconsFilled(), cls });
}

/** Vorschaubild, wenn die Cloud eins hat; sonst das Symbol. */
export function thumbOrGlyph(it, size = 'm', big = false) {
  const src = loadedSource(it.conn);
  if (!it.isFolder && it.thumb && src?.thumbUrl) {
    const wrap = h('span.thumb' + (big ? '.big' : ''), glyph(it, big));
    Promise.resolve().then(() => src.thumbUrl(it, size)).then((u) => {
      if (!u) return;
      // im Dokument (versteckt), damit „lazy“ greift; erst wenn es geladen ist, ersetzt es das Symbol
      const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', draggable: false, style: { position: 'absolute', opacity: 0, width: '1px', height: '1px' } });
      img.onload = () => { img.removeAttribute('style'); wrap.replaceChildren(img); wrap.classList.add('has-img'); };
      img.onerror = () => img.remove();
      img.src = u;
      wrap.append(img);
    }).catch(() => {});
    return wrap;
  }
  return glyph(it, big);
}

// ---------------------------------------------------------------- Zuletzt geöffnet (nur auf diesem Gerät)

export async function recent() { return (await kv.get('recent')) || []; }
export async function addRecent(it) {
  if (!it.conn) return;
  const list = (await recent()).filter((r) => !(r.conn === it.conn && r.path.toLowerCase() === it.path.toLowerCase()));
  list.unshift({ conn: it.conn, path: it.path, name: it.name, size: it.size, mtime: it.mtime, thumb: !!it.thumb, at: Date.now() });
  await kv.set('recent', list.slice(0, 40));
}

// ---------------------------------------------------------------- Ändern

const badName = (n) => /[\\/:*?"<>|]/.test(n) || !n.trim();
export const NAME_RULE = 'Der Name darf keines dieser Zeichen enthalten: \\ / : * ? " < > |';

export async function newFolder(connId, path, name) {
  if (badName(name)) throw new Error(NAME_RULE);
  await (await source(connId)).mkdir(path, name);
}

export async function rename(it, name) {
  if (badName(name)) throw new Error(NAME_RULE);
  if (!writable(it.conn, it.path)) throw new Error('Schreibgeschützt.');
  await (await source(it.conn)).rename(it, name);
  const to = joinPath(parentPath(it.path), name);
  await store.movePaths(keyOf(it.conn), relPath(it.path), relPath(to));
}

export async function remove(items) {
  if (!items.length) return false;
  if (items.some((it) => !writable(it.conn, it.path))) { toast('Schreibgeschützt – hier kann nichts gelöscht werden.', 'err'); return false; }
  const text = items.length === 1 ? `„${items[0].name}“ löschen?` : `${items.length} Einträge löschen?`;
  if (!(await confirmDialog(text + ' Es landet im Papierkorb der Cloud und lässt sich dort noch eine Weile wiederherstellen.', { title: 'Löschen', ok: 'Löschen', danger: true }))) return false;
  const op = startOp(items.length === 1 ? `„${items[0].name}“ löschen` : `${items.length} Einträge löschen`);
  let n = 0;
  try {
    for (const it of items) {
      await (await source(it.conn)).remove(it);
      await store.forgetPaths(keyOf(it.conn), relPath(it.path));
      op.update(Math.round((++n / items.length) * 100));
    }
    toast(n === 1 ? 'Gelöscht' : `${n} gelöscht`);
  } catch (e) { toast(errText(e), 'err'); } finally { op.done(); }
  return n > 0;
}

export const errText = (e) => (e?.message || String(e)) + (e?.detail ? ` (${e.detail})` : '');

// ---------------------------------------------------------------- Zwischenablage: Kopieren und Verschieben

export const clipboard = { items: [], cut: false };
export function setClipboard(items, cut) {
  clipboard.items = items.slice();
  clipboard.cut = cut;
  toast(`${items.length === 1 ? '„' + items[0].name + '“' : items.length + ' Einträge'} ${cut ? 'ausgeschnitten' : 'kopiert'} – im Zielordner „Einfügen“`);
}

/** Einfügen in connId/path. Gleiches still überspringen, Namensgleiches mit anderem Inhalt als „Name (2)“. */
export async function paste(connId, path, items = clipboard.items, cut = clipboard.cut) {
  if (!items.length) return 0;
  if (!writable(connId, path)) { toast('Der Zielordner ist schreibgeschützt.', 'err'); return 0; }
  if (cut && items.some((it) => !writable(it.conn, it.path))) { toast('Schreibgeschützt – verschieben geht nicht, nur kopieren.', 'err'); return 0; }
  const dest = await source(connId);
  const taken = new Map((await dest.list(path)).map((x) => [x.name.toLowerCase(), x]));
  const op = startOp(`${items.length === 1 ? '„' + items[0].name + '“' : items.length + ' Einträge'} ${cut ? 'verschieben' : 'kopieren'}`);
  let n = 0;
  try {
    for (const it of items) {
      if (it.isFolder && it.conn === connId && (path.toLowerCase() === it.path.toLowerCase() || path.toLowerCase().startsWith(it.path.toLowerCase() + '/'))) {
        toast(`„${it.name}“ kann nicht in sich selbst ${cut ? 'verschoben' : 'kopiert'} werden.`, 'err');
        continue;
      }
      if (cut && it.conn === connId && parentPath(it.path).toLowerCase() === path.toLowerCase()) continue; // liegt schon hier
      const ex = taken.get(it.name.toLowerCase());
      if (ex && !it.isFolder && !ex.isFolder && ex.size === it.size && it.conn === connId) { n++; continue; } // gleiche Datei liegt schon da
      const name = ex ? uniqueName(it.name, new Set(taken.keys())) : it.name;
      if (it.conn === connId) {
        const src = await source(it.conn);
        if (cut) { await src.move(it, path, name); await store.movePaths(keyOf(connId), relPath(it.path), relPath(joinPath(path, name))); }
        else await src.copy(it, path, name);
      } else {
        await crossCopy(it, connId, path, name, cut);
      }
      taken.set(name.toLowerCase(), { ...it, name });
      n++;
      op.update(Math.round((n / items.length) * 100));
    }
  } catch (e) { toast(errText(e), 'err'); } finally { op.done(); }
  if (cut) clipboard.items = [];
  return n;
}

/** Zwischen zwei Clouds: Ordner anlegen, Dateien über die Warteschlange (laden und hochladen). Beim Verschieben danach das Original löschen. */
async function crossCopy(it, connId, path, name, cut) {
  const src = await source(it.conn);
  const dest = await source(connId);
  if (!it.isFolder) {
    addFiles([{ name, size: it.size, load: () => src.blob(it) }], connId, path, {
      label: connName(connId) + ' › ' + (baseName(path) || connName(connId)), register: false,
      after: cut ? async () => { await src.remove(it); } : null,
    });
    return;
  }
  await dest.mkdir(path, name).catch((e) => { if (!/schon/.test(e.message)) throw e; });
  const target = joinPath(path, name);
  for (const child of await src.list(it.path)) {
    if (isSystem(child)) continue;
    await crossCopy({ ...child, conn: it.conn }, connId, target, child.name, false);
  }
  if (cut) toast(`Ordner „${it.name}“ wurde kopiert. Das Original bitte nach dem Hochladen selbst löschen.`);
}

// ---------------------------------------------------------------- Herunterladen, Teilen

/** Datei ans Teilen-Menü von iOS geben (dort „In Dateien sichern“ – auch auf die FRITZ!NAS –, AirDrop, andere Apps). */
export async function download(it) {
  if (it.file) { await shareOrDownload(it.file, it.name); return; }
  const op = startOp(`„${it.name}“ laden`);
  const t0 = Date.now();
  let blob;
  try { blob = await (await source(it.conn)).blob(it); } catch (e) { op.done(); toast(errText(e), 'err'); return; }
  op.done();
  // iOS öffnet das Teilen-Menü nur direkt nach einem Tippen: nach längerem Laden einmal bestätigen lassen
  if (Date.now() - t0 < 1500) { await shareOrDownload(blob, it.name); return; }
  const s = sheet(h('div.dialog-body.center', h('p', `„${it.name}“ ist geladen.`),
    h('button.btn.primary.block', { onclick: async () => { s.close(); await shareOrDownload(blob, it.name); } }, icon('share'), ' Teilen / Sichern')), { title: 'Bereit' });
}

export async function shareLink(it) {
  try {
    const src = await source(it.conn);
    if (!src.shareLink) { toast('Diese Cloud bietet keine Teilen-Links.', 'err'); return; }
    const url = await src.shareLink(it);
    if (navigator.share) { try { await navigator.share({ title: it.name, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    await navigator.clipboard.writeText(url);
    toast('Link kopiert');
  } catch (e) { toast(errText(e), 'err'); }
}

// ---------------------------------------------------------------- Einstellungen je Ordner (landen in der Einstellungsdatei)

export const setHidden = (it, on) => store.setEntry('hidden', keyOf(it.conn), relPath(it.path), on ? {} : null);
export const setIgnored = (connId, path, on) => store.setEntry('ignored', keyOf(connId), relPath(path), on ? {} : null);
export const setReadOnly = (it, on) => store.setEntry('readOnly', keyOf(it.conn), relPath(it.path), on ? { isFolder: !!it.isFolder } : null);
export const setFavorite = (it, on) => store.setEntry('favorites', keyOf(it.conn), relPath(it.path), on ? { name: it.name, isFolder: !!it.isFolder } : null);
/**
 * Farbe/Symbol eines Ordners – gilt in jeder Cloud, in der derselbe Ordner (gleicher Pfad ab Wurzel) liegt.
 * Alle Einträge bekommen dieselbe Zeit; Quellen nur am PC (lokal:) ergänzt der PC beim Abgleich.
 */
export async function setFolderStyle(it, color, ic) {
  const path = relPath(it.path);
  const value = color || ic ? { color: color || null, icon: ic || null } : null;
  const keys = new Set([keyOf(it.conn)]);
  await Promise.all(connections().filter((c) => c.id !== it.conn && c.type !== 'demo').map(async (c) => {
    try {
      if (!c.key || keys.has(c.key)) return;
      if (path === '') { keys.add(c.key); return; }
      const items = await listFolder(c.id, parentPath(it.path));
      if (items.some((x) => x.isFolder && x.name.toLowerCase() === it.name.toLowerCase())) keys.add(c.key);
    } catch { /* Cloud gerade nicht erreichbar oder Ordner fehlt dort */ }
  }));
  // Gibt es schon Stile für diesen Pfad in anderen Clouds (z. B. vom PC), werden sie ebenfalls angepasst
  for (const e of store.entries('folderStyles')) if (e.path.toLowerCase() === path.toLowerCase()) keys.add(e.cloud);
  await store.setEntries('folderStyles', [...keys].filter(Boolean).map((cloud) => ({ cloud, path, value })));
  return keys.size;
}
export const setLock = (connId, path, r) => store.setEntry('locks', keyOf(connId), relPath(path), r ? { hash: r.hash, pinLength: r.length } : null);

/** Favoriten dieses Geräts mit passender Quelle (Kennung aus der Einstellungsdatei). */
export function favorites() {
  return store.entries('favorites').map((f) => ({ ...f, connObj: connByKey(f.cloud) })).filter((f) => f.connObj)
    .map((f) => ({ conn: f.connObj.id, path: '/' + f.path, name: f.name || baseName('/' + f.path) || f.connObj.name, isFolder: f.isFolder !== false }));
}

export async function needsKey(connId) {
  if (keyOf(connId)) return true;
  try { const src = await source(connId); const me = await src.info(); const c = connById(connId); c.key = me.key; return true; } catch { return false; }
}
