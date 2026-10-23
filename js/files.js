// Datei-Manager: Orte, Ordner, Vorschau, Aktionen, Ordnerauswahl.

import { h, icon, kindIcon, kindOf, fmtSize, fmtDate, toast, sheet, actionSheet, confirmDialog, promptDialog, shareOrDownload, debounce, norm, clear } from './util.js';
import { state, isProtectedPcloud, isHidden, lockFor, managedFolderFor, sendJob, pcloudLocationId, basePath, isDemo, updateHandy } from './sync.js';
import { cache } from './db.js';
import { settings, saveSettings, go, filesHash, unlocked } from './ui.js';
import { askPin } from './lock.js';
import { exportPdf, exportXlsx } from './export.js';

const KIND_LABEL = { ordner: 'Ordner', bild: 'Bild', video: 'Video', audio: 'Musik', pdf: 'PDF', dokument: 'Dokument', archiv: 'Archiv', datei: 'Datei' };

// ---------------------------------------------------------------- Orte

export function sources() {
  const out = [{ id: pcloudLocationId(), name: 'pCloud', kind: 'cloud', live: true }];
  for (const l of state.index) out.push({ id: l.id, name: l.name, kind: l.kind, live: false });
  return out;
}
const sourceById = (id) => sources().find((s) => s.id === id);
const srcIcon = (kind) => (kind === 'cloud' ? 'cloud' : kind === 'storage' ? 'pc' : 'disk');

function pcloudItem(x) {
  return { ...x, source: 'pcloud', location: pcloudLocationId(), locationName: 'pCloud', rel: x.path.replace(/^\/+/, '') };
}
function indexItem(loc, i) {
  const it = loc.item(i);
  return { ...it, source: 'index', locationName: loc.name, rel: it.path };
}

export async function loadListing(locId, rel) {
  const src = sourceById(locId);
  if (!src) throw new Error('Dieser Ort ist nicht (mehr) vorhanden.');
  if (src.live) {
    const path = '/' + rel;
    const key = 'list:' + path;
    try {
      const r = await state.backend.list(path);
      const items = r.items.map(pcloudItem);
      cache.set(key, { at: new Date().toISOString(), folderid: r.folderid, items }).catch(() => {});
      return { items, folderid: r.folderid, live: true };
    } catch (e) {
      if (!e.offline) throw e;
      const c = await cache.get(key);
      if (!c) throw new Error('Offline – dieser Ordner wurde noch nie geöffnet.');
      return { items: c.items, folderid: c.folderid, offline: true, cachedAt: c.at, live: true };
    }
  }
  const loc = state.index.find((l) => l.id === locId);
  const idx = rel ? loc.find(rel) : -1;
  if (idx === null) throw new Error('Diesen Ordner gibt es in der Liste vom PC nicht (mehr).');
  return { items: loc.children(idx).map((i) => indexItem(loc, i)), live: false, generated: state.indexGenerated };
}

/** Pfad der Sicherungskopie eines PC-Elements in pCloud (wenn der Ordner nach pCloud gesichert wird). */
export function pcloudCopyPath(item) {
  if (item.source !== 'index' || item.location !== 'storage') return null;
  const conn = pcloudLocationId();
  const p = item.rel.toLowerCase();
  const f = (state.status?.folders || []).find((x) => {
    const fp = x.path.replace(/\\/g, '/').toLowerCase();
    return (p === fp || p.startsWith(fp + '/')) && (x.targets || []).includes(conn) && x.mode !== 'DiskOnly';
  });
  return f ? basePath() + '/' + item.rel : null;
}

function statusLabel(it) {
  if (it.source === 'pcloud') return isProtectedPcloud('/' + it.rel) ? 'Sicherung' : '';
  if (it.offloaded) return 'Ausgelagert';
  if (it.backedUp) return 'Gesichert';
  return 'Nur auf Speicher';
}

// ---------------------------------------------------------------- Ansicht „Dateien“

let viewState = { items: [], loc: null, rel: '', filter: '', selecting: false, selected: new Set() };

export async function renderFiles(view, parts) {
  const srcs = sources();
  const locId = parts[1] || settings.lastSource || srcs[0].id;
  const src = sourceById(locId) || srcs[0];
  const rel = parts[2] || '';
  if (settings.lastSource !== src.id) { settings.lastSource = src.id; saveSettings(); }
  viewState = { ...viewState, loc: src.id, rel, selecting: false, selected: new Set() };

  const chips = h('div.chips', srcs.map((s) => h('button.chip' + (s.id === src.id ? '.on' : ''), { onclick: () => go(filesHash(s.id)) }, icon(srcIcon(s.kind)), s.name)));
  const crumbs = h('div.crumbs');
  const segs = rel ? rel.split('/') : [];
  crumbs.append(h('button.crumb', { onclick: () => go(filesHash(src.id)) }, src.name));
  segs.forEach((s, i) => crumbs.append(h('span.sep', '›'), h('button.crumb', { onclick: () => go(filesHash(src.id, segs.slice(0, i + 1).join('/'))) }, s)));

  const filterInput = h('input.input.filter', { type: 'search', placeholder: 'In diesem Ordner filtern', value: viewState.filter, enterkeyhint: 'search' });
  const listBox = h('div.listbox', h('div.loading', 'Lädt …'));
  const notice = h('div.notice-slot');
  const toolbar = h('div.toolbar',
    filterInput,
    h('button.icon-btn', { title: 'Sortieren', 'aria-label': 'Sortieren', onclick: () => sortMenu(() => paint()) }, icon('sort')),
    h('button.icon-btn', { title: 'Ansicht', 'aria-label': 'Ansicht wechseln', onclick: () => { settings.view = settings.view === 'liste' ? 'kacheln' : 'liste'; saveSettings(); paint(); } }, icon(settings.view === 'liste' ? 'grid' : 'list')),
    h('button.icon-btn', { title: 'Mehr', 'aria-label': 'Mehr', onclick: () => folderMenu(src, rel, () => renderFiles(view, parts)) }, icon('more')));

  const selBar = h('div.selbar');
  clear(view).append(h('div.page-head', h('h1', 'Dateien')), chips, crumbs, toolbar, notice, selBar, listBox);

  filterInput.addEventListener('input', debounce(() => { viewState.filter = filterInput.value; paint(); }, 120));

  // Ordner-PIN
  const lk = lockFor(src.id, rel);
  const lockKey = lk && src.id + ':' + lk.path;
  if (lk && lk.hash && !unlocked.has(lockKey)) {
    clear(listBox).append(h('div.empty', icon('lock', 'big'), h('p', 'Dieser Bereich ist mit einer PIN geschützt.'),
      h('button.btn.primary', { onclick: async () => { if (await askPin('PIN für „' + (lk.path || src.name) + '“', lk.hash, lk.pinLength || 4)) { unlocked.add(lockKey); renderFiles(view, parts); } } }, 'Entsperren')));
    return;
  }

  let res;
  try {
    res = await loadListing(src.id, rel);
  } catch (e) {
    clear(listBox).append(h('div.empty', icon('warn', 'big'), h('p', e.message), h('button.btn', { onclick: () => renderFiles(view, parts) }, 'Erneut versuchen')));
    return;
  }
  viewState.items = res.items;
  viewState.folderid = res.folderid;
  if (res.offline) notice.append(h('div.notice', icon('cloud'), `Offline – Stand vom ${fmtDate(res.cachedAt)}`));
  if (!res.live) notice.append(h('div.notice.soft', icon('pc'), `Liste vom PC, Stand ${fmtDate(res.generated)}. Änderungen hier laufen als Auftrag über den PC.`));
  if (src.live && isProtectedPcloud('/' + rel) && rel) notice.append(h('div.notice.soft', icon('shield'), 'Sicherungsbereich des PCs: hier nur ansehen und herunterladen.'));

  function visible() {
    const f = norm(viewState.filter.trim());
    let items = viewState.items.filter((it) => settings.showHidden || !(it.hidden || isHidden(it.location, it.rel)));
    if (src.live && !settings.showHidden) items = items.filter((it) => !/^\.(mobil|versionen|orbitnas)$/i.test(it.name));
    if (f) items = items.filter((it) => norm(it.name).includes(f));
    const { by, dir } = settings.sort;
    items.sort((a, b) => (b.isFolder - a.isFolder) || dir * (by === 'name' ? a.name.localeCompare(b.name, 'de', { numeric: true }) : by === 'date' ? a.mtime - b.mtime : a.size - b.size));
    return items;
  }

  function paint() {
    const items = visible();
    viewState.visible = items;
    paintSelBar();
    clear(listBox);
    if (!items.length) { listBox.append(h('div.empty', icon('folder', 'big'), h('p', viewState.filter ? 'Nichts gefunden.' : 'Dieser Ordner ist leer.'))); return; }
    const grid = settings.view === 'kacheln';
    const list = h(grid ? 'div.grid' : 'div.list');
    for (const it of items) list.append(itemRow(it, grid));
    listBox.append(list, h('div.count', `${items.length} ${items.length === 1 ? 'Eintrag' : 'Einträge'}`));
  }

  function itemRow(it, grid) {
    const kind = kindOf(it.name, it.isFolder);
    const sel = viewState.selected.has(it);
    const thumb = it.source === 'pcloud' && it.thumb && !it.isFolder
      ? h('img.thumb', { src: state.backend.thumbUrl(it.fileid, grid ? '256x256' : '120x120'), loading: 'lazy', alt: '' })
      : h('span.ficon.k-' + kind, icon(kindIcon[kind]));
    const hidden = it.hidden || isHidden(it.location, it.rel);
    const badges = [];
    if (it.source === 'index') badges.push(h('span.dot.' + (it.offloaded ? 'blue' : it.backedUp ? 'green' : 'gray'), { title: statusLabel(it) }));
    if (lockFor(it.location, it.rel)?.hash) badges.push(icon('lock', 'tiny'));
    const meta = it.isFolder ? (it.size ? fmtSize(it.size) : '') + (it.mtime ? (it.size ? ' · ' : '') + fmtDate(it.mtime, false) : '') : `${fmtSize(it.size)} · ${fmtDate(it.mtime, false)}`;
    const row = h('div.item' + (grid ? '.tile' : '.row') + (hidden ? '.dim' : '') + (sel ? '.sel' : ''), {
      tabindex: 0, role: 'button',
      onclick: () => {
        if (viewState.selecting) { toggleSel(it); return; }
        if (it.isFolder) go(filesHash(it.location, it.rel)); else openPreview(it, viewState.visible.filter((x) => !x.isFolder));
      },
      onkeydown: (e) => { if (e.key === 'Enter') row.click(); },
      oncontextmenu: (e) => { e.preventDefault(); itemMenu(it, () => renderFiles(view, parts)); },
    },
    viewState.selecting ? h('span.check' + (sel ? '.on' : ''), icon('check')) : null,
    h('div.thumbwrap', thumb),
    h('div.iname', h('div.n', it.name, ...badges), h('div.m', meta)),
    grid ? null : h('button.icon-btn.more', { 'aria-label': 'Aktionen', onclick: (e) => { e.stopPropagation(); itemMenu(it, () => renderFiles(view, parts)); } }, icon('more')));
    longPress(row, () => { if (!viewState.selecting) startSelect(it); });
    return row;
  }

  function startSelect(it) { viewState.selecting = true; viewState.selected = new Set(it ? [it] : []); paint(); }
  function toggleSel(it) { viewState.selected.has(it) ? viewState.selected.delete(it) : viewState.selected.add(it); paint(); }
  function paintSelBar() {
    clear(selBar);
    selBar.classList.toggle('show', viewState.selecting);
    if (!viewState.selecting) return;
    const n = viewState.selected.size;
    const sel = [...viewState.selected];
    const canChange = src.live && sel.length && sel.every((x) => !isProtectedPcloud('/' + x.rel));
    selBar.append(
      h('button.btn.small', { onclick: () => { viewState.selecting = false; paint(); } }, 'Fertig'),
      h('span.selcount', `${n} ausgewählt`),
      h('button.btn.small', { onclick: () => { viewState.selected = new Set(viewState.visible); paint(); } }, 'Alle'),
      src.live ? h('button.icon-btn', { disabled: !n, 'aria-label': 'Kopieren', onclick: () => bulkCopyMove(sel, false, () => renderFiles(view, parts)) }, icon('copy')) : null,
      src.live ? h('button.icon-btn', { disabled: !canChange, 'aria-label': 'Verschieben', onclick: () => bulkCopyMove(sel, true, () => renderFiles(view, parts)) }, icon('move')) : null,
      src.live ? h('button.icon-btn.danger', { disabled: !canChange, 'aria-label': 'Löschen', onclick: () => bulkDelete(sel, () => renderFiles(view, parts)) }, icon('trash')) : null,
      h('button.icon-btn', { disabled: !n, 'aria-label': 'Exportieren', onclick: () => exportMenu(src.name + (rel ? ' – ' + rel : ''), sel) }, icon('export')));
  }

  viewState.startSelect = startSelect;
  paint();
}

function longPress(el, fn) {
  let t;
  el.addEventListener('touchstart', () => { t = setTimeout(() => { t = null; navigator.vibrate && navigator.vibrate(10); fn(); }, 550); }, { passive: true });
  const cancel = () => clearTimeout(t);
  el.addEventListener('touchend', (e) => { if (t === null) e.preventDefault(); cancel(); });
  el.addEventListener('touchmove', cancel, { passive: true });
}

function sortMenu(after) {
  const set = (by) => { settings.sort = { by, dir: settings.sort.by === by ? -settings.sort.dir : (by === 'name' ? 1 : -1) }; saveSettings(); after(); };
  const arrow = (by) => (settings.sort.by === by ? (settings.sort.dir > 0 ? ' ↑' : ' ↓') : '');
  actionSheet('Sortieren', [
    { label: 'Name' + arrow('name'), onclick: () => set('name') },
    { label: 'Datum' + arrow('date'), onclick: () => set('date') },
    { label: 'Größe' + arrow('size'), onclick: () => set('size') },
  ]);
}

function folderMenu(src, rel, refresh) {
  const canWrite = src.live && !isProtectedPcloud('/' + rel);
  actionSheet(rel ? rel.split('/').pop() : src.name, [
    { label: 'Auswählen', icon: 'select', onclick: () => viewState.startSelect && viewState.startSelect() },
    canWrite && { label: 'Neuer Ordner', icon: 'plusFolder', onclick: async () => {
      const name = await promptDialog('Name des neuen Ordners', '', { title: 'Neuer Ordner', ok: 'Anlegen' });
      if (!name) return;
      try { await state.backend.mkdir('/' + (rel ? rel + '/' : '') + name); toast('Ordner angelegt'); refresh(); } catch (e) { toast(e.message, 'err'); }
    } },
    canWrite && { label: 'Hierher hochladen', icon: 'upload', onclick: () => go('#/hochladen?ziel=' + encodeURIComponent('/' + rel)) },
    { label: 'Liste exportieren', icon: 'export', onclick: () => exportMenu(src.name + (rel ? ' – ' + rel : ''), viewState.visible || []) },
    { label: settings.showHidden ? 'Versteckte ausblenden' : 'Versteckte zeigen', icon: settings.showHidden ? 'eyeOff' : 'eye', onclick: () => { settings.showHidden = !settings.showHidden; saveSettings(); refresh(); } },
    { label: 'Aktualisieren', icon: 'sync', onclick: refresh },
  ]);
}

export function exportMenu(title, items) {
  const rows = items.map((it) => ({ ...it, kindLabel: KIND_LABEL[kindOf(it.name, it.isFolder)], statusLabel: statusLabel(it), path: it.rel ?? it.path }));
  actionSheet('Exportieren', [
    { label: 'Als PDF', icon: 'pdf', hint: `${rows.length} Einträge`, onclick: () => exportPdf(title, rows).catch((e) => toast(e.message, 'err')) },
    { label: 'Als Excel-Tabelle', icon: 'doc', hint: `${rows.length} Einträge`, onclick: () => exportXlsx(title, rows).catch((e) => toast(e.message, 'err')) },
  ]);
}

// ---------------------------------------------------------------- Aktionen für ein Element

export function itemMenu(it, refresh = () => {}) {
  const live = it.source === 'pcloud';
  const prot = live && isProtectedPcloud('/' + it.rel);
  const hidden = it.hidden || isHidden(it.location, it.rel);
  const managed = !live && it.location === 'storage' && it.isFolder ? managedFolderFor(it.rel) : null;
  const copyPath = pcloudCopyPath(it);
  const fav = isFavorite(it);
  actionSheet(it.name, [
    !it.isFolder && { label: 'Öffnen', icon: 'eye', onclick: () => openPreview(it, [it]) },
    it.isFolder && { label: 'Öffnen', icon: 'folder', onclick: () => go(filesHash(it.location, it.rel)) },
    !it.isFolder && (live || copyPath) && { label: 'Auf Gerät sichern / teilen', icon: 'share', onclick: () => saveToDevice(it) },
    !live && !it.isFolder && !copyPath && { label: 'Auf Handy holen', icon: 'download', hint: 'Der PC legt die Datei in pCloud bereit', onclick: () => job('bereitstellen', { location: it.location, path: it.rel }, `„${it.name}“ bereitstellen`) },
    live && !prot && { label: 'Umbenennen', icon: 'edit', onclick: () => renameItem(it, refresh) },
    live && { label: 'Kopieren nach …', icon: 'copy', onclick: () => bulkCopyMove([it], false, refresh) },
    live && !prot && { label: 'Verschieben nach …', icon: 'move', onclick: () => bulkCopyMove([it], true, refresh) },
    managed && { label: 'Jetzt sichern', icon: 'shield', onclick: () => job('sichern', { folderIds: [managed.id] }, `„${managed.name}“ sichern`, true) },
    managed && managed.mode !== 'CloudOnly' && (managed.targets || []).length > 0 && { label: 'Auslagern (nur Cloud)', icon: 'cloud', hint: 'Spart Platz auf dem Speicher', onclick: () => job('auslagern', { folderId: managed.id }, `„${managed.name}“ auslagern`, true) },
    managed && managed.mode === 'CloudOnly' && { label: 'Zurückholen', icon: 'download', onclick: () => job('zurueckholen', { folderId: managed.id }, `„${managed.name}“ zurückholen`, true) },
    { label: fav ? 'Aus Favoriten entfernen' : 'Zu Favoriten', icon: 'star', onclick: () => toggleFavorite(it) },
    { label: hidden ? 'Einblenden' : 'Verstecken', icon: hidden ? 'eye' : 'eyeOff', hint: 'Wird vom PC übernommen', onclick: () => job('verstecken', { location: it.location, path: it.rel, hidden: !hidden }, `„${it.name}“ ${hidden ? 'einblenden' : 'verstecken'}`) },
    { label: 'Eigenschaften', icon: 'info', onclick: () => properties(it) },
    live && !prot && { label: 'Löschen', icon: 'trash', danger: true, onclick: () => bulkDelete([it], refresh) },
  ]);
}

async function job(type, args, label, ask = false) {
  if (ask && !(await confirmDialog(`${label}? Der PC erledigt das, sobald Orbit NAS dort läuft.`, { ok: 'Auftrag senden' }))) return;
  try { await sendJob(type, args, label); toast('Auftrag an den PC gesendet'); } catch (e) { toast(e.message, 'err'); }
}

async function renameItem(it, refresh) {
  const dot = it.isFolder ? -1 : it.name.lastIndexOf('.');
  const name = await promptDialog('', it.name, { title: 'Umbenennen', ok: 'Umbenennen', select: (v) => (dot > 0 ? dot : v.length) });
  if (!name || name === it.name) return;
  if (/[\\/]/.test(name)) { toast('Der Name darf kein / oder \\ enthalten.', 'err'); return; }
  try { await state.backend.rename(it, name); toast('Umbenannt'); refresh(); } catch (e) { toast(e.message, 'err'); }
}

async function bulkDelete(items, refresh) {
  const text = items.length === 1
    ? `„${items[0].name}“ löschen? Es landet im pCloud-Papierkorb und kann dort wiederhergestellt werden.`
    : `${items.length} Einträge löschen? Sie landen im pCloud-Papierkorb und können dort wiederhergestellt werden.`;
  if (!(await confirmDialog(text, { title: 'Löschen', ok: 'Löschen', danger: true }))) return;
  let ok = 0;
  for (const it of items) { try { await state.backend.remove(it); ok++; } catch (e) { toast(`${it.name}: ${e.message}`, 'err'); } }
  if (ok) toast(ok === 1 ? 'Gelöscht' : `${ok} gelöscht`);
  refresh();
}

async function bulkCopyMove(items, move, refresh) {
  const target = await pickFolder(move ? 'Verschieben nach' : 'Kopieren nach');
  if (target == null) return;
  let fid;
  try { fid = await state.backend.folderId(target); } catch (e) { toast(e.message, 'err'); return; }
  let ok = 0;
  for (const it of items) {
    if (it.isFolder && (target + '/').startsWith('/' + it.rel + '/')) { toast('Ein Ordner kann nicht in sich selbst.', 'err'); continue; }
    try { await (move ? state.backend.move(it, fid) : state.backend.copy(it, fid)); ok++; } catch (e) { toast(`${it.name}: ${e.message}`, 'err'); }
  }
  if (ok) toast(`${ok} ${move ? 'verschoben' : 'kopiert'}`);
  refresh();
}

function properties(it) {
  const rows = [
    ['Name', it.name], ['Art', KIND_LABEL[kindOf(it.name, it.isFolder)]], ['Ort', it.locationName],
    ['Pfad', '/' + it.rel], ['Größe', it.isFolder && !it.size ? '–' : `${fmtSize(it.size)} (${Math.round(it.size).toLocaleString('de-DE')} Bytes)`],
    ['Geändert', fmtDate(it.mtime) || '–'], ['Status', statusLabel(it) || '–'],
  ];
  if (it.source === 'index' && it.isFolder) {
    const loc = state.index.find((l) => l.id === it.location);
    let files = 0, folders = 0;
    const walk = (i) => { for (const c of loc.children(i)) { if (loc.e[c][2] & 1) { folders++; walk(c); } else files++; } };
    walk(it.idx);
    rows.push(['Inhalt', `${files.toLocaleString('de-DE')} Dateien, ${folders.toLocaleString('de-DE')} Ordner`]);
  }
  sheet(h('dl.props', rows.map(([k, v]) => [h('dt', k), h('dd', v)])), { title: 'Eigenschaften' });
}

// ---------------------------------------------------------------- Favoriten (vom PC + eigene, auf allen Handys gleich)

export function favorites() {
  const pc = (state.status?.favorites || []).map((f) => ({ ...f, from: 'pc' }));
  const own = Object.values(state.handy.favs || {}).filter((f) => !f.del).sort((a, b) => a.t - b.t).map((f) => ({ ...f, from: 'handy' }));
  return [...pc, ...own];
}
const favKey = (it) => it.location + ':' + it.rel;
function isFavorite(it) { const f = (state.handy.favs || {})[favKey(it)]; return !!f && !f.del; }
async function toggleFavorite(it) {
  const was = isFavorite(it);
  await updateHandy((hd) => {
    hd.favs = hd.favs || {};
    hd.favs[favKey(it)] = { location: it.location, path: it.rel, name: it.name, isFolder: it.isFolder, t: Date.now(), del: was };
  });
  toast(was ? 'Aus Favoriten entfernt' : 'Zu Favoriten hinzugefügt');
}
export async function openFavorite(f) {
  if (f.isFolder) { go(filesHash(f.location, f.path)); return; }
  const parent = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
  try {
    const r = await loadListing(f.location, parent);
    const it = r.items.find((x) => x.name === f.path.split('/').pop());
    if (it) openPreview(it, [it]); else toast('Die Datei gibt es dort nicht mehr.', 'err');
  } catch (e) { toast(e.message, 'err'); }
}

// ---------------------------------------------------------------- Vorschau

async function linkFor(it) {
  if (it.source === 'pcloud') return state.backend.fileLink(it);
  const p = pcloudCopyPath(it);
  if (p) return state.backend.fileLink({ path: p });
  return null;
}

export async function saveToDevice(it) {
  const big = it.size > 400e6;
  try {
    const link = await linkFor(it);
    if (!link) { toast('Im Beispiel nicht verfügbar.'); return; }
    if (big) {
      if (!(await confirmDialog(`Die Datei ist ${fmtSize(it.size)} groß. Sie wird in Safari geöffnet; dort über das Teilen-Symbol „In Dateien sichern“ wählen.`, { ok: 'Öffnen' }))) return;
      window.open(link, '_blank');
      return;
    }
    toast('Lade „' + it.name + '“ …');
    const res = await fetch(link);
    if (!res.ok) throw new Error('Download fehlgeschlagen');
    await shareOrDownload(await res.blob(), it.name);
  } catch (e) { toast(e.message, 'err'); }
}

export function openPreview(it, siblings = [it]) {
  let index = Math.max(0, siblings.indexOf(it));
  const stage = h('div.stage');
  const info = h('div.pinfo');
  const body = h('div.preview', stage, info);
  const s = sheet(body, { title: it.name, wide: true, onClose: () => { document.removeEventListener('keydown', onKey); stage.querySelector('video,audio')?.pause(); } });
  const title = s.el.querySelector('.sheet-head h2');

  const show = async () => {
    const cur = siblings[index];
    title.textContent = cur.name;
    const kind = kindOf(cur.name, false);
    clear(stage).append(h('div.loading', 'Lädt …'));
    clear(info).append(
      h('dl.props', [h('dt', 'Größe'), h('dd', fmtSize(cur.size)), h('dt', 'Geändert'), h('dd', fmtDate(cur.mtime)), h('dt', 'Ort'), h('dd', cur.locationName + ' · /' + cur.rel)]),
      h('div.btn-col',
        h('button.btn.primary', { onclick: () => saveToDevice(cur) }, icon('share'), ' Auf Gerät sichern / teilen'),
        h('button.btn', { onclick: () => { s.close(); itemMenu(cur); } }, icon('more'), ' Weitere Aktionen')));
    let link = null;
    try { link = await linkFor(cur); } catch (e) { clear(stage).append(h('div.empty', icon('warn', 'big'), h('p', e.message))); return; }
    if (siblings[index] !== cur) return;
    clear(stage);
    if (!link) {
      stage.append(h('div.empty', icon(kindIcon[kind], 'big'),
        h('p', cur.source === 'index' ? 'Diese Datei liegt nur am PC bzw. auf der FRITZ!NAS.' : 'Vorschau im Beispiel nicht verfügbar.'),
        cur.source === 'index' ? h('button.btn.primary', { onclick: () => job('bereitstellen', { location: cur.location, path: cur.rel }, `„${cur.name}“ bereitstellen`) }, 'Auf Handy holen') : null));
      return;
    }
    if (kind === 'bild') stage.append(h('img.full', { src: link, alt: cur.name, onerror: () => stage.replaceChildren(h('div.empty', h('p', 'Dieses Bildformat kann iOS nicht anzeigen.'))) }));
    else if (kind === 'video') {
      const v = h('video.full', { src: link, controls: true, playsinline: true, preload: 'metadata' });
      v.addEventListener('error', () => stage.replaceChildren(h('div.empty', icon('video', 'big'), h('p', 'Dieses Videoformat spielt iOS nicht ab (z. B. MKV/AVI). Tipp: „Auf Gerät sichern“ und mit einer Player-App öffnen.'))));
      stage.append(v);
    } else if (kind === 'audio') stage.append(h('div.audio', icon('audio', 'big'), h('audio', { src: link, controls: true })));
    else if (kind === 'pdf' || kind === 'dokument') stage.append(h('div.empty', icon(kindIcon[kind], 'big'), h('button.btn.primary', { onclick: () => window.open(link, '_blank') }, 'Dokument öffnen')));
    else stage.append(h('div.empty', icon(kindIcon[kind], 'big'), h('p', 'Keine Vorschau für diese Art von Datei.')));
    if (siblings.length > 1) {
      stage.append(h('button.pnav.prev', { 'aria-label': 'Vorherige', onclick: () => step(-1) }, icon('back')), h('button.pnav.next', { 'aria-label': 'Nächste', onclick: () => step(1) }, icon('back')));
    }
  };
  const step = (d) => { index = (index + d + siblings.length) % siblings.length; show(); };
  const onKey = (e) => { if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); };
  document.addEventListener('keydown', onKey);
  let sx = null;
  stage.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  stage.addEventListener('touchend', (e) => { if (sx == null || siblings.length < 2) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1); sx = null; });
  show();
}

// ---------------------------------------------------------------- Ordnerauswahl (pCloud)

export function pickFolder(title, start = state.handy.lastFolder?.path || '/') {
  return new Promise((resolve) => {
    let path = start;
    let done = false;
    const list = h('div.picker-list');
    const head = h('div.picker-head');
    const okBtn = h('button.btn.primary', {}, 'Hier auswählen');
    const body = h('div.picker', head, list, h('div.btn-row',
      h('button.btn', { onclick: async () => {
        const name = await promptDialog('Name des neuen Ordners', '', { title: 'Neuer Ordner', ok: 'Anlegen' });
        if (!name) return;
        try { await state.backend.mkdir((path === '/' ? '' : path) + '/' + name); load((path === '/' ? '' : path) + '/' + name); } catch (e) { toast(e.message, 'err'); }
      } }, icon('plusFolder'), ' Neuer Ordner'), okBtn));
    const s = sheet(body, { title, onClose: () => { if (!done) resolve(null); } });
    okBtn.onclick = () => { done = true; s.close(); resolve(path); };

    async function load(p) {
      path = p;
      const prot = isProtectedPcloud(p) && p !== '/';
      okBtn.disabled = prot;
      clear(head).append(
        p !== '/' ? h('button.icon-btn', { 'aria-label': 'Zurück', onclick: () => load(p.slice(0, p.lastIndexOf('/')) || '/') }, icon('back')) : null,
        h('div.picker-path', 'pCloud' + (p === '/' ? '' : p.replace(/\//g, ' › '))),
        prot ? h('small.muted', 'Sicherungsbereich – hier nicht möglich') : null);
      clear(list).append(h('div.loading', 'Lädt …'));
      try {
        const r = await state.backend.list(p);
        const folders = r.items.filter((x) => x.isFolder && !/^\.(mobil|versionen|orbitnas)$/i.test(x.name) && (settings.showHidden || !isHidden(pcloudLocationId(), x.path.slice(1))))
          .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
        clear(list);
        if (!folders.length) list.append(h('div.empty.small', 'Keine Unterordner'));
        for (const f of folders) list.append(h('button.item.row', { onclick: () => load(f.path) }, h('span.ficon.k-ordner', icon('folder')), h('div.iname', h('div.n', f.name)), icon('back', 'flip')));
      } catch (e) {
        if (e.notFound && p !== '/') { load('/'); return; }
        clear(list).append(h('div.empty', e.message));
      }
    }
    load(start);
  });
}

export { KIND_LABEL, statusLabel, isDemo };
