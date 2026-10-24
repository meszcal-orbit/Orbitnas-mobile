// Orte wie am PC (Speicher, Festplatten, Clouds, weitere Orte, „Alle Quellen“), ihre Listen und alle Änderungen.
// pCloud ändert das Handy direkt, alles andere erledigt der PC über Aufträge.

import { state, isProtectedPcloud, isHidden, isIgnored, lockFor, managedFolderFor, sendJob, awaitJob, pcloudLocationId, basePath, patchStatus, isDemo } from './sync.js';
import { cache } from './db.js';
import { h, fmtSize, toast, confirmDialog, shareOrDownload } from './util.js';

export const ALL = 'alle';

// Standardfarben wie am PC (FileNodes.cs), falls der PC keine eigene Quellenfarbe schickt.
const KIND_GRAD = {
  storage: ['#22D3EE', '#0EA5E9'], disk: ['#F472B6', '#E11D48'], cloud: ['#818CF8', '#6D28D9'], extra: ['#34D399', '#059669'], all: ['#FBBF24', '#F97316'],
};
const KIND_TYPE = { storage: 'Speicherort', disk: 'Festplatte / FRITZ!Box', cloud: 'Cloud', extra: 'Weiterer Ort' };

function lighten(hex, a = 0.35) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.round(v + (255 - v) * a).toString(16).padStart(2, '0');
  return '#' + ch(n >> 16) + ch((n >> 8) & 255) + ch(n & 255);
}

/** Alle Orte in der Reihenfolge des PCs: Speicher, Festplatten, Clouds (Haupt-Cloud zuerst), weitere Orte. */
export function locations() {
  const st = state.status;
  const conn = pcloudLocationId();
  const fromStatus = st?.locations || [];
  const list = [];
  const seen = new Set();
  const add = (l) => { if (!seen.has(l.id)) { seen.add(l.id); list.push(l); } };
  const order = { storage: 0, disk: 1, cloud: 2, extra: 3 };
  const sorted = [...fromStatus].sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
  for (const l of sorted) {
    const indexed = state.index.find((x) => x.id === l.id);
    const mode = l.id === conn ? 'pcloud' : indexed ? 'index' : l.kind === 'cloud' ? 'remote' : 'index';
    add(makeLoc(l, mode));
  }
  // Orte, die nur im Index stehen (ältere PC-Version), und pCloud selbst
  for (const x of state.index) add(makeLoc({ id: x.id, name: x.name, kind: x.kind }, 'index'));
  if (!seen.has(conn)) list.splice(list.findIndex((l) => l.kind === 'cloud' || l.kind === 'extra') >>> 0, 0, makeLoc({ id: conn, name: 'pCloud', kind: 'cloud', type: 'PCloud', primary: true }, 'pcloud'));
  if (list.length > 1) list.unshift({ id: ALL, name: 'Alle Quellen', kind: 'all', mode: 'all', grad: KIND_GRAD.all, color: '#F59E0B', typeText: 'Alles zusammen', spaceText: list.length + ' Quellen' });
  return list;
}

function makeLoc(l, mode) {
  const grad = l.color ? [lighten(l.color), l.color] : KIND_GRAD[l.kind] || KIND_GRAD.extra;
  let typeText = l.kind === 'cloud' ? (l.type === 'PCloud' ? 'pCloud' : l.type || 'Cloud') + (l.primary ? ' · Haupt-Cloud' : '') : KIND_TYPE[l.kind] || '';
  if (l.drive) typeText += ` · Laufwerk ${String(l.drive).replace(/:?$/, ':')}`;
  if (lockFor(l.id, '')?.hash && lockFor(l.id, '').path === '') typeText += ' · mit PIN';
  const spaceText = l.total ? `${fmtSize(l.free ?? l.total - l.used)} frei von ${fmtSize(l.total)}` : l.online === false ? 'Nicht erreichbar' : '';
  return { ...l, mode, grad, color: grad[1], typeText, spaceText, usedPct: l.total ? Math.min(100, (l.used / l.total) * 100) : null };
}

export const locById = (id) => locations().find((l) => l.id === id) || null;
export const locColor = (id) => locById(id)?.color || '#94A3B8';
export const locName = (id) => locById(id)?.name || id;

// ---------------------------------------------------------------- Einträge

/** Zustand wie am PC: backed (grün), pending (orange), cloudOnly (blau), localOnly (grau). */
export function fileState(it) {
  if (it.location !== 'storage') return null;
  if (it.offloaded) return 'cloudOnly';
  if (it.pendingBackup) return 'pending';
  if (it.backedUp) return 'backed';
  return managedFor(it.rel) ? 'pending' : 'localOnly';
}
const STATE_TEXT = { backed: 'Gesichert', pending: 'Noch nicht gesichert', cloudOnly: 'Nur in der Cloud (ausgelagert)', localOnly: 'Nur hier, ohne Sicherung' };
export function stateText(it) {
  const s = fileState(it);
  if (!s) return '';
  const f = managedFor(it.rel);
  const names = s !== 'localOnly' && f ? (f.targets || []).map(locName).filter(Boolean) : [];
  return STATE_TEXT[s] + (names.length ? ': ' + names.join(', ') : '');
}

/** Der von Orbit NAS gesicherte Ordner, in dem dieser Pfad liegt. */
export function managedFor(rel) {
  const p = rel.toLowerCase();
  return (state.status?.folders || []).find((f) => { const fp = f.path.replace(/\\/g, '/').toLowerCase(); return p === fp || p.startsWith(fp + '/'); }) || null;
}

/** Auf welchen Quellen liegt der Eintrag? (für die farbigen Punkte) */
export function sourcesOf(it) {
  if (it.sources) return it.sources;
  if (it.location !== 'storage') return [it.location];
  const f = managedFor(it.rel);
  const targets = f && (it.backedUp || it.offloaded) ? (f.targets || []) : [];
  return [...(it.offloaded ? [] : ['storage']), ...targets];
}

function fromIndex(loc, i) {
  const x = loc.item(i);
  const flags = loc.e[i][2];
  return { ...x, rel: x.path, pendingBackup: !!(flags & 16), multi: !!(flags & 32), kind: 'index' };
}
function fromPcloud(x) {
  return { ...x, location: pcloudLocationId(), rel: x.path.replace(/^\/+/, ''), kind: 'pcloud' };
}
function fromRemote(locId, parent, e) {
  const [name, flags, size, mtime] = e;
  const rel = (parent ? parent + '/' : '') + name;
  return { name, isFolder: !!(flags & 1), size, mtime: mtime * 1000, hidden: !!(flags & 2), offloaded: !!(flags & 4), backedUp: !!(flags & 8), location: locId, rel, path: rel, kind: 'remote' };
}

export const SYSTEM = /^\.(mobil|versionen|orbitnas|verschluesselt)$/i;

/**
 * Liest einen Ordner. Ergebnis: { items, live, offline, cachedAt, generated, waiting (Auftrag läuft), folderid }.
 * opts.refresh: bei Orten ohne Index die Liste neu beim PC anfordern.
 */
export async function listFolder(locId, rel, opts = {}) {
  const loc = locById(locId);
  if (!loc) throw new Error('Diesen Ort gibt es nicht (mehr).');
  if (loc.mode === 'all') return listAll(rel, opts);
  if (loc.mode === 'pcloud') {
    const path = '/' + rel;
    const key = 'list:' + path;
    try {
      const r = await state.backend.list(path);
      const items = r.items.filter((x) => !SYSTEM.test(x.name)).map(fromPcloud);
      cache.set(key, { at: new Date().toISOString(), folderid: r.folderid, items }).catch(() => {});
      return { items, folderid: r.folderid, live: true };
    } catch (e) {
      if (!e.offline) throw e;
      const c = await cache.get(key);
      if (!c) throw new Error('Offline – dieser Ordner wurde hier noch nie geöffnet.');
      return { items: c.items, folderid: c.folderid, offline: true, cachedAt: c.at, live: true };
    }
  }
  if (loc.mode === 'index') {
    const ix = state.index.find((l) => l.id === locId);
    if (!ix) return { items: [], generated: null, note: 'Vom PC ist für diesen Ort noch keine Liste da.' };
    const i = rel ? ix.find(rel) : -1;
    if (i === null) throw new Error('Diesen Ordner gibt es in der Liste vom PC nicht (mehr).');
    return { items: ix.children(i).map((c) => fromIndex(ix, c)), generated: state.indexGenerated };
  }
  // Clouds ohne Index (Internxt, Hetzner …): Liste per Auftrag vom PC
  const key = 'liste:' + locId + ':' + rel;
  const c = await cache.get(key);
  const pending = state.jobs.find((j) => j.type === 'liste' && j.args.location === locId && (j.args.path || '') === rel && (j.state === 'gesendet' || j.state === 'laeuft'));
  if (!c || opts.refresh) {
    const id = pending?.id || await sendJob('liste', { location: locId, path: rel }, `Liste von „${loc.name}“ holen`);
    return { items: c ? c.entries.map((e) => fromRemote(locId, rel, e)) : [], waiting: id, cachedAt: c?.at };
  }
  return { items: c.entries.map((e) => fromRemote(locId, rel, e)), cachedAt: c.at, waiting: pending?.id };
}

/** „Alle Quellen“: alle Orte übereinander gelegt. Gleiche Einträge (gleicher Pfad, gleiche Größe) erscheinen einmal mit Punkten. */
async function listAll(rel) {
  // Wie am PC: alle Orte übereinander. Bei Clouds/Platten wird der Basisordner (OrbitNAS) in die oberste Ebene
  // eingeblendet, damit Sicherungskopien neben dem Original liegen.
  const base = (state.pairing?.base || 'OrbitNAS').replace(/^\/+|\/+$/g, '');
  const locs = locations().filter((l) => l.mode !== 'all' && !(lockFor(l.id, rel)?.hash));
  const read = async (l, r) => {
    if (l.mode === 'remote') {
      const c = await cache.get('liste:' + l.id + ':' + r);
      return c ? c.entries.map((e) => fromRemote(l.id, r, e)) : [];
    }
    try { return (await listFolder(l.id, r)).items; } catch { return []; }
  };
  const results = await Promise.all(locs.map(async (l) => {
    const own = (await read(l, rel)).filter((it) => !(l.id !== 'storage' && !rel && it.isFolder && it.name.toLowerCase() === base.toLowerCase()));
    const copies = l.id === 'storage' ? [] : (await read(l, base + (rel ? '/' + rel : ''))).map((it) => ({ ...it, backupCopy: true }));
    return [...own, ...copies];
  }));
  const byName = new Map();
  for (const it of results.flat()) {
    if (isIgnored(it.location, it.rel) || SYSTEM.test(it.name)) continue;
    const key = it.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(it);
  }
  const out = [];
  for (const group of byName.values()) {
    // Dateien: gleicher Name + gleiche Größe = dieselbe Datei. Ordner: nur mit ihrer Sicherungskopie zusammen.
    const clusters = [];
    for (const it of group) {
      let c = null;
      if (!it.isFolder) c = clusters.find((x) => !x[0].isFolder && x[0].size === it.size);
      else if (it.backupCopy) c = clusters.find((x) => x[0].isFolder && x.some((m) => m.location === 'storage' && !m.backupCopy));
      if (c) c.push(it); else clusters.push([it]);
    }
    for (const c of clusters) {
      const main = c.find((x) => x.kind === 'pcloud' && !x.backupCopy) || c.find((x) => !x.backupCopy) || c[0];
      out.push({
        ...main, members: c, sources: [...new Set(c.flatMap((x) => sourcesOf(x)))], allView: true,
        rel: (rel ? rel + '/' : '') + main.name,
        suffix: clusters.length > 1 ? [...new Set(c.map((x) => locName(x.location)))].join(', ') : '',
        size: c[0].isFolder ? Math.max(...c.map((x) => x.size || 0)) : main.size,
        mtime: Math.max(...c.map((x) => x.mtime || 0)),
      });
    }
  }
  return { items: out, all: true };
}

// ---------------------------------------------------------------- Sichtbarkeit und Rechte

export const hiddenItem = (it) => (it.members || [it]).every((x) => x.hidden || isHidden(x.location, x.rel));
export const ignoredItem = (it) => (it.members || [it]).every((x) => isIgnored(x.location, x.rel));

/** Kann das Handy diesen Ort/Pfad direkt ändern? (nur pCloud außerhalb des Sicherungsbereichs) */
/** Schreibgeschützt (samt Inhalt)? Liefert den Eintrag aus status.readOnly oder null. */
export function readOnlyFor(locId, rel) {
  const p = (rel || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
  return (state.status?.readOnly || []).find((r) => {
    if (r.location !== locId) return false;
    const x = (r.path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
    return x === '' || p === x || p.startsWith(x + '/');
  }) || null;
}

export const direct = (locId, rel) => locById(locId)?.mode === 'pcloud' && !isProtectedPcloud('/' + rel) && !readOnlyFor(locId, rel);

/** Darf hier überhaupt etwas geändert werden (direkt oder per Auftrag)? */
export function writable(locId, rel) {
  const loc = locById(locId);
  if (!loc || loc.mode === 'all' || readOnlyFor(locId, rel)) return false;
  if (loc.mode === 'pcloud') return !isProtectedPcloud('/' + rel);
  return true;
}

// ---------------------------------------------------------------- Änderungen

async function viaPc(type, args, label, { ask, quiet } = {}) {
  if (ask && !(await confirmDialog(ask, { title: label, ok: 'Auftrag senden' }))) return null;
  const id = await sendJob(type, args, label);
  if (!quiet) toast(isDemo() ? 'Auftrag gesendet (Beispiel)' : 'Auftrag an den PC gesendet – erledigt, sobald Orbit NAS dort läuft');
  return id;
}
export { viaPc };

const parentOf = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');

export async function newFolder(locId, rel, name) {
  if (direct(locId, rel)) { await state.backend.mkdir('/' + (rel ? rel + '/' : '') + name); return 'direct'; }
  await viaPc('ordnerNeu', { location: locId, path: rel, name }, `Ordner „${name}“ anlegen`);
  return 'job';
}

export async function rename(it, name) {
  if (it.kind === 'pcloud' && direct(it.location, it.rel)) { await state.backend.rename(it, name); return 'direct'; }
  await viaPc('umbenennen', { location: it.location, path: it.rel, name }, `„${it.name}“ umbenennen`);
  return 'job';
}

export async function remove(items) {
  const anyPc = items.some((it) => !(it.kind === 'pcloud' && direct(it.location, it.rel)));
  const fritz = items.some((it) => locById(it.location)?.kind === 'disk');
  const what = items.length === 1 ? `„${items[0].name}“` : `${items.length} Einträge`;
  const text = `${what} löschen?` + (fritz ? ' Auf der FRITZ!Box-Festplatte ist das endgültig.' : anyPc ? ' Am PC landet es im Papierkorb.' : ' Es landet im pCloud-Papierkorb.');
  if (!(await confirmDialog(text, { title: 'Löschen', ok: 'Löschen', danger: true }))) return 0;
  let n = 0;
  for (const it of items) {
    try {
      if (it.kind === 'pcloud' && direct(it.location, it.rel)) await state.backend.remove(it);
      else await viaPc('loeschen', { location: it.location, path: it.rel }, `„${it.name}“ löschen`, { quiet: true });
      n++;
    } catch (e) { toast(`${it.name}: ${e.message}`, 'err'); }
  }
  if (anyPc && n) toast('Auftrag an den PC gesendet');
  return n;
}

// Zwischenablage wie am PC: Ausschneiden/Kopieren, dann „Einfügen in diesen Ordner“.
export const clipboard = { items: [], cut: false };
export function setClipboard(items, cut) {
  clipboard.items = items.map((it) => (it.members ? (it.members.find((m) => m.kind === 'pcloud') || it.members[0]) : it));
  clipboard.cut = cut;
  toast(`${items.length === 1 ? '„' + items[0].name + '“' : items.length + ' Einträge'} ${cut ? 'ausgeschnitten' : 'kopiert'}. Jetzt Zielordner öffnen und „Einfügen“.`);
}

export async function paste(locId, rel) {
  const items = clipboard.items;
  if (!items.length) return 0;
  const cut = clipboard.cut;
  let fid = null;
  let n = 0;
  let jobs = 0;
  for (const it of items) {
    if (it.isFolder && it.location === locId && (rel + '/').startsWith(it.rel + '/')) { toast('Ein Ordner kann nicht in sich selbst.', 'err'); continue; }
    if (cut && it.location === locId && parentOf(it.rel) === rel) continue;
    try {
      if (it.kind === 'pcloud' && direct(locId, rel) && it.location === locId && (!cut || direct(it.location, it.rel))) {
        if (fid == null) fid = await state.backend.folderId('/' + rel || '/');
        await (cut ? state.backend.move(it, fid) : state.backend.copy(it, fid));
      } else {
        await sendJob(cut ? 'verschieben' : 'kopieren', { from: { location: it.location, path: it.rel }, to: { location: locId, folder: rel } },
          `„${it.name}“ ${cut ? 'verschieben' : 'kopieren'} nach ${locName(locId)}${rel ? ' › ' + rel.replace(/\//g, ' › ') : ''}`);
        jobs++;
      }
      n++;
    } catch (e) { toast(`${it.name}: ${e.message}`, 'err'); }
  }
  if (cut) { clipboard.items = []; clipboard.cut = false; }
  if (jobs) toast(`${jobs === 1 ? 'Auftrag' : jobs + ' Aufträge'} an den PC gesendet`);
  else if (n) toast(`${n} ${cut ? 'verschoben' : 'eingefügt'}`);
  return n;
}

export async function setHidden(items, hidden) {
  for (const it of items) {
    await sendJob('verstecken', { location: it.location, path: it.rel, hidden }, `„${it.name}“ ${hidden ? 'verstecken' : 'wieder sichtbar machen'}`);
    await patchStatus((st) => {
      st.hidden = st.hidden || {};
      const list = (st.hidden[it.location] = st.hidden[it.location] || []);
      const i = list.findIndex((x) => x.toLowerCase() === it.rel.toLowerCase());
      if (hidden && i < 0) list.push(it.rel);
      if (!hidden && i >= 0) list.splice(i, 1);
    });
  }
  toast(hidden ? 'Versteckt – „Versteckte“ oben zeigt es wieder' : 'Wieder sichtbar');
}

export async function setIgnored(it, on) {
  await sendJob('ignorieren', { location: it.location, path: it.rel, on }, `„${it.name}“ ${on ? 'dauerhaft ignorieren' : 'nicht mehr ignorieren'}`);
  await patchStatus((st) => {
    st.ignored = st.ignored || {};
    const list = (st.ignored[it.location] = st.ignored[it.location] || []);
    const i = list.findIndex((x) => x.toLowerCase() === it.rel.toLowerCase());
    if (on && i < 0) list.push(it.rel);
    if (!on && i >= 0) list.splice(i, 1);
  });
}

export async function setFolderStyle(it, color, iconName) {
  await sendJob('ordnerStil', { location: it.location, path: it.rel, color, icon: iconName }, `Farbe/Symbol für „${it.name}“`);
  await patchStatus((st) => {
    st.folderStyles = (st.folderStyles || []).filter((f) => !(f.location === it.location && f.path.toLowerCase() === it.rel.toLowerCase()));
    if (color || iconName) st.folderStyles.push({ location: it.location, path: it.rel, color, icon: iconName });
  });
}

export function isFavorite(it) {
  return (state.status?.favorites || []).some((f) => f.location === it.location && f.path.toLowerCase() === it.rel.toLowerCase());
}
export async function setFavorite(it, on) {
  await sendJob('favorit', { location: it.location, path: it.rel, name: it.name, isFolder: it.isFolder, on }, `„${it.name}“ ${on ? 'zu Favoriten' : 'aus Favoriten'}`);
  await patchStatus((st) => {
    st.favorites = (st.favorites || []).filter((f) => !(f.location === it.location && f.path.toLowerCase() === it.rel.toLowerCase()));
    if (on) st.favorites.push({ location: it.location, path: it.rel, name: it.name, isFolder: it.isFolder });
  });
  toast(on ? 'Zu Favoriten hinzugefügt' : 'Aus Favoriten entfernt');
}

// ---------------------------------------------------------------- Öffnen und Herunterladen

/** Pfad der Sicherungskopie in pCloud (wenn der Ordner nach pCloud gesichert wird). */
export function pcloudCopyPath(it) {
  if (it.location !== 'storage') return null;
  const conn = pcloudLocationId();
  const f = managedFor(it.rel);
  // Verschlüsselte Sicherungen kann nur der PC lesen (Auftrag „bereitstellen“).
  if (!f || f.encrypted || !(f.targets || []).includes(conn) || f.mode === 'DiskOnly') return null;
  if (!(it.backedUp || it.offloaded)) return null;
  return basePath() + '/' + it.rel;
}

/** Direkter Link zum Ansehen/Abspielen, oder null (dann muss der PC die Datei bereitstellen). */
export async function linkFor(it) {
  try { return await linkFor_(it); } catch (e) {
    if (e.code !== 'LOGIN') throw e;
    const { openLogin } = await import('./pairing.js');
    if (await openLogin({ reason: e.message })) return linkFor_(it);
    throw e;
  }
}
async function linkFor_(it) {
  const m = it.members ? (it.members.find((x) => x.kind === 'pcloud') || it.members.find((x) => pcloudCopyPath(x)) || it.members[0]) : it;
  if (m.kind === 'pcloud') return state.backend.fileLink(m);
  const p = pcloudCopyPath(m);
  if (p) return state.backend.fileLink({ path: p, name: m.name });
  const ready = (await cache.get('pickup:' + m.location + ':' + m.rel));
  if (ready) return state.backend.fileLink({ path: ready });
  return null;
}

/** Datei vom PC/von der FRITZ!NAS in pCloud bereitstellen lassen und warten. */
export async function fetchViaPc(it, onWait) {
  const m = it.members ? it.members[0] : it;
  const id = await sendJob('bereitstellen', { location: m.location, path: m.rel }, `„${m.name}“ aufs Handy holen`);
  onWait && onWait(id);
  const j = await awaitJob(id);
  if (!j || j.state !== 'fertig' || !j.pickup) throw new Error(j?.message || 'Der PC hat die Datei (noch) nicht bereitgestellt. Läuft Orbit NAS am PC?');
  await cache.set('pickup:' + m.location + ':' + m.rel, j.pickup);
  return state.backend.fileLink({ path: j.pickup });
}

export async function download(it) {
  try {
    let link = await linkFor(it);
    if (!link) {
      if (isDemo()) { toast('Im Beispiel nicht verfügbar.'); return; }
      toast('Der PC stellt die Datei bereit … (bis zu 2 Minuten)');
      link = await fetchViaPc(it);
    }
    if (it.size > 400e6) {
      if (!(await confirmDialog(`Die Datei ist ${fmtSize(it.size)} groß. Sie wird in Safari geöffnet; dort über das Teilen-Symbol „In Dateien sichern“ wählen.`, { ok: 'Öffnen' }))) return;
      window.open(link, '_blank');
      return;
    }
    toast('Lade „' + it.name + '“ …');
    const res = await fetch(link);
    if (!res.ok) throw new Error('Herunterladen fehlgeschlagen');
    await shareOrDownload(await res.blob(), it.name);
  } catch (e) { toast(e.message, 'err'); }
}

export async function setReadOnly(it, on) {
  await sendJob('schreibschutz', { location: it.location, path: it.rel, on }, `„${it.name}“ ${on ? 'schreibschützen' : 'Schreibschutz aufheben'}`);
  await patchStatus((st) => {
    st.readOnly = (st.readOnly || []).filter((r) => !(r.location === it.location && (r.path || '').toLowerCase() === it.rel.toLowerCase()));
    if (on) st.readOnly.push({ location: it.location, path: it.rel, isFolder: it.isFolder });
  });
  toast(on ? 'Schreibgeschützt – der PC übernimmt es' : 'Schreibschutz aufgehoben');
}

/** Kann der PC für diesen Eintrag einen öffentlichen Link erstellen? (pCloud oder unverschlüsselte Kopie in pCloud) */
export const canShareLink = (it) => (it.members || [it]).some((x) => x.kind === 'pcloud' || !!pcloudCopyPath(x));

export async function shareLink(it) {
  const m = it.members ? (it.members.find((x) => x.kind === 'pcloud') || it.members.find((x) => pcloudCopyPath(x)) || it.members[0]) : it;
  toast('Der PC erstellt den Link … (bis zu 2 Minuten)');
  const id = await sendJob('teilenLink', { location: m.location, path: m.rel }, `Teilen-Link für „${m.name}“`);
  const j = await awaitJob(id);
  const link = j?.link || (j?.state === 'fertig' && /^https?:\/\//.test(j.message || '') ? j.message : null);
  if (!link) { toast(j?.message || 'Kein Link erhalten. Läuft Orbit NAS am PC?', 'err'); return; }
  try { if (navigator.share) { await navigator.share({ title: m.name, url: link }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(link); toast('Link kopiert'); } catch { toast(link); }
}

/** Vorschaubild aus pCloud. Liefert pCloud es nicht mit dem Zugang vom PC, wird es mit der Anmeldung geholt. */
export function thumbImg(sel, fileid, size, alt = '') {
  const img = h(sel, { src: state.backend.thumbUrl(fileid, size), loading: 'lazy', alt });
  img.addEventListener('error', () => {
    if (img.dataset.tried || !state.backend.thumbBlobUrl) { img.style.visibility = 'hidden'; return; }
    img.dataset.tried = '1';
    state.backend.thumbBlobUrl(fileid, size).then((u) => { img.src = u; }).catch(() => { img.style.visibility = 'hidden'; });
  });
  return img;
}
