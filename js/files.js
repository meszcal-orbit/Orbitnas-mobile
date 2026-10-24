// Datei-Manager genau wie am PC: Kopf mit Suche, Orte-Karten, Baum (iPad quer), Inhalt als Liste oder Kacheln,
// dieselben Kontextmenüs, Zwischenablage über alle Orte, Eigenschaften, Speicher-Analyse – plus Hochladen vom Handy.

import { h, icon, kindOf, kindIcon, KIND_COLOR, typeName, fmtSize, fmtDate, toast, sheet, actionSheet, confirmDialog, promptDialog, debounce, norm, clear, uid } from './util.js';
import { state, isHidden, isIgnored, lockFor, folderStyle, sendJob, pcloudLocationId, basePath, patchStatus, onChange } from './sync.js';
import { settings, saveSettings, go, filesHash, unlocked, isLandscapeWide, route } from './ui.js';
import { askPin, choosePin, lockEnabled, showLockScreen, lockImmediately } from './lock.js';
import { askSecurity } from './secq.js';
import {
  ALL, locations, locById, locName, listFolder, fileState, stateText, managedFor, sourcesOf, hiddenItem, ignoredItem, direct, writable,
  newFolder, rename, remove, clipboard, setClipboard, paste, setHidden, setIgnored, setFolderStyle, isFavorite, setFavorite, download, viaPc,
  readOnlyFor, setReadOnly, canShareLink, shareLink,
  thumbImg,
} from './locations.js';
import { backupNow, offload, restore, folderDialog, addConnectionInfo } from './backup.js';
import { openPlayer } from './player.js';
import { addFiles, onQueue, stats, queue, cancel, retry, clearFinished } from './upload.js';

// Symbole, die man einem Ordner geben kann (wie am PC 0.6), und die Farbauswahl.
export const FOLDER_ICONS = ['folder', 'star', 'heart', 'image', 'music', 'video', 'doc', 'work', 'home', 'lock', 'cloud', 'archive'];
const ICON_OF = { photo: 'image', music: 'music', video: 'video', doc: 'doc', work: 'work', home: 'home', lock: 'lock', cloud: 'cloud', archive: 'archive', star: 'star', heart: 'heart', folder: 'folder' };
const FOLDER_COLORS = ['#F5B544', '#EF4444', '#F97316', '#EAB308', '#22C55E', '#14B8A6', '#0EA5E9', '#3B82F6', '#6366F1', '#A855F7', '#EC4899', '#94A3B8'];
const STATE_ICON = { backed: ['cloudCheck', 'ok'], pending: ['clock', 'warn'], cloudOnly: ['cloud', 'accent'], localOnly: ['disk', 'muted'] };
const BADGE = { Mirrored: 'gesichert', CloudOnly: 'ausgelagert', DiskOnly: 'verwaltet' };

// Verlauf für Zurück/Vor wie im Explorer
const hist = { list: [], pos: -1, jump: false };
const expanded = new Set(['storage']);
let view = null;
let cur = { loc: null, rel: '', items: [], visible: [], res: null, search: null, selecting: false, selected: new Set() };

// ---------------------------------------------------------------- Seite

export async function renderFiles(el, parts) {
  view = el;
  const locs = locations();
  if (!locs.length) {
    clear(view).append(h('div.page', h('div.empty', icon('pc', 'big'), h('p', 'Vom PC sind noch keine Orte da. Orbit NAS am PC öffnen (ab Version 0.5.2), dann kommt alles in ein bis zwei Minuten.'))));
    return;
  }
  let locId = parts[1] || settings.lastLocation;
  if (!locs.some((l) => l.id === locId)) locId = (locs.find((l) => l.id === 'storage') || locs.find((l) => l.mode !== 'all') || locs[0]).id;
  const rel = parts[2] || '';
  if (settings.lastLocation !== locId) { settings.lastLocation = locId; saveSettings(); }
  const here = filesHash(locId, rel);
  if (hist.jump) hist.jump = false;
  else if (hist.list[hist.pos] !== here) { hist.list = hist.list.slice(0, hist.pos + 1); hist.list.push(here); hist.pos = hist.list.length - 1; }
  const changedFolder = cur.loc !== locId || cur.rel !== rel;
  cur = { ...cur, loc: locId, rel, selecting: changedFolder ? false : cur.selecting, selected: changedFolder ? new Set() : cur.selected, search: changedFolder ? null : cur.search, filter: changedFolder ? '' : cur.filter };
  for (let i = 0, p = ''; rel && i < rel.split('/').length; i++) { p = p ? p + '/' + rel.split('/')[i] : rel.split('/')[i]; expanded.add(locId + ':' + p); }
  expanded.add(locId + ':');

  const searchIn = h('input.search', { type: 'search', placeholder: 'Suchen … (Enter = auch Unterordner)', enterkeyhint: 'search', value: cur.search?.q || cur.filter || '', autocapitalize: 'off', autocorrect: 'off' });
  const tb = (ic, title, on, onclick) => h('button.tbtn' + (on ? '.on' : ''), { title, 'aria-label': title, onclick }, icon(ic));
  const head = h('header.fhead',
    h('div.brand', h('img', { src: 'icons/icon-192.png', alt: '' }), h('span', 'Orbit NAS')),
    h('div.searchbox', icon('search'), searchIn),
    h('div.tbtns',
      lockEnabled() ? tb('lock', 'Wieder sperren', false, async () => { unlocked.clear(); await lockImmediately(); showLockScreen({ force: true }); }) : null,
      tb('chart', 'Speicher-Analyse', false, () => analysis(locId, rel)),
      settings.showEyeButton === false ? null : tb(settings.showHidden ? 'eye' : 'eyeOff', settings.showHidden ? 'Versteckte ausblenden' : 'Versteckte zeigen', settings.showHidden, () => { settings.showHidden = !settings.showHidden; saveSettings(); paint(); paintTree(); }),
      tb('grid', settings.tileView ? 'Als Liste anzeigen' : 'Als Kacheln anzeigen', settings.tileView, () => { settings.tileView = !settings.tileView; saveSettings(); paint(); }),
      tb('sync', 'Aktualisieren', false, () => refresh(true))));

  const cards = h('div.loccards', locs.map((l) => locCard(l, l.id === locId)),
    h('button.loccard.add', { onclick: addConnectionInfo }, icon('plus'), h('span', 'Ort hinzufügen')));

  const tree = h('aside.tree');
  const content = h('section.content');
  const status = h('footer.fstatus');
  clear(view).append(h('div.files', head, cards, h('div.fbody', tree, content), status));
  requestAnimationFrame(() => cards.querySelector('.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' }));

  searchIn.addEventListener('input', debounce(() => { cur.filter = searchIn.value; if (!searchIn.value) cur.search = null; paint(); }, 120));
  searchIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchIn.blur(); deepSearch(searchIn.value.trim()); } if (e.key === 'Escape') { searchIn.value = ''; cur.filter = ''; cur.search = null; paint(); } });

  // Inhaltsleiste: Zurück, Vor, Nach oben, Pfad, Aktionen
  const loc = locById(locId);
  const crumbs = h('div.crumbs');
  const segs = rel ? rel.split('/') : [];
  crumbs.append(h('button.crumb', { onclick: () => go(filesHash(locId)) }, loc.name));
  segs.forEach((s, i) => crumbs.append(icon('chevron', 'sep'), h('button.crumb', { onclick: () => go(filesHash(locId, segs.slice(0, i + 1).join('/'))) }, s)));
  const canWrite = writable(locId, rel);
  const cbar = h('div.cbar',
    h('div.navbtns',
      h('button.nbtn', { title: 'Zurück', disabled: hist.pos <= 0, onclick: () => { hist.pos--; hist.jump = true; go(hist.list[hist.pos]); } }, icon('back')),
      h('button.nbtn', { title: 'Vor', disabled: hist.pos >= hist.list.length - 1, onclick: () => { hist.pos++; hist.jump = true; go(hist.list[hist.pos]); } }, icon('forward')),
      h('button.nbtn', { title: 'Nach oben', disabled: !rel, onclick: () => go(filesHash(locId, segs.slice(0, -1).join('/'))) }, icon('up'))),
    crumbs,
    h('div.cactions',
      clipboard.items.length && canWrite ? h('button.nbtn', { title: 'Einfügen in diesen Ordner', onclick: async () => { if (await paste(locId, rel)) refresh(); } }, icon('paste')) : null,
      h('button.nbtn' + (cur.selecting ? '.on' : ''), { title: 'Auswählen', onclick: () => { cur.selecting = !cur.selecting; cur.selected.clear(); paint(); } }, icon('select')),
      canWrite ? h('button.nbtn', { title: 'Hochladen', onclick: () => uploadMenu(locId, rel) }, icon('upload')) : null,
      canWrite ? h('button.nbtn', { title: 'Neuer Ordner', onclick: () => askNewFolder(locId, rel) }, icon('plusFolder')) : null,
      !isLandscapeWide() ? h('button.nbtn', { title: 'Favoriten', onclick: favoritesSheet }, icon('star')) : null));
  const notices = h('div.notices');
  const selbar = h('div.selbar');
  const listBox = h('div.listbox', { oncontextmenu: (e) => { if (e.target === listBox) { e.preventDefault(); backgroundMenu(); } } });
  content.append(cbar, notices, selbar, listBox);
  paintTree();

  // Ordner-PIN wie am PC: Bereich erst nach richtiger PIN zeigen
  const lk = lockFor(locId, rel);
  const lockKey = lk && locId + ':' + lk.path;
  if (lk?.hash && !unlocked.has(lockKey)) {
    clear(listBox).append(h('div.empty', icon('lock', 'big warnc'), h('p', `„${lk.path ? lk.path.split('/').pop() : loc.name}“ ist mit einer PIN geschützt.`),
      h('button.btn.primary', { onclick: async () => { if (await askPin('PIN für „' + (lk.path ? lk.path.split('/').pop() : loc.name) + '“', lk.hash, lk.pinLength || 4)) { unlocked.add(lockKey); renderFiles(view, parts); paintTree(); } } }, 'Entsperren')));
    paintStatus();
    return;
  }

  clear(listBox).append(h('div.loading', h('div.spinner'), 'Lädt …'));
  let res;
  try { res = await listFolder(locId, rel); } catch (e) {
    clear(listBox).append(h('div.empty', icon('warn', 'big'), h('p', e.message), h('button.btn', { onclick: () => refresh() }, 'Erneut versuchen')));
    return;
  }
  if (route().parts[1] && route().parts[1] !== locId) return; // inzwischen woanders hin navigiert
  cur.items = res.items;
  cur.res = res;
  cur.folderid = res.folderid;
  clear(notices);
  if (res.offline) notices.append(h('div.notice', icon('cloud'), `Offline – Stand vom ${fmtDate(res.cachedAt)}`));
  if (res.generated && Date.now() - Date.parse(res.generated) > 3600000) notices.append(h('div.notice.soft', icon('pc'), `Liste vom PC, Stand ${fmtDate(res.generated)}.`));
  if (res.note) notices.append(h('div.notice.soft', icon('info'), res.note));
  if (loc.mode === 'pcloud' && rel && !direct(locId, rel)) notices.append(h('div.notice.soft', icon('shield'), 'Hier liegen die Sicherungen des PCs. Ändern bitte über den Speicher – hier nur ansehen und herunterladen.'));
  if (readOnlyFor(locId, rel)) notices.append(h('div.notice.soft', icon('lock'), 'Schreibgeschützt – hier kann nichts geändert, verschoben oder gelöscht werden (aufheben im Menü des Ordners).'));
  if (res.all) notices.append(h('div.notice.soft', icon('layers'), 'Alle Quellen zusammen. Die Punkte unter dem Symbol zeigen, wo etwas überall liegt.'));
  if (res.waiting) {
    notices.append(h('div.notice', h('div.spinner.small'), res.items.length ? `Aktuelle Liste kommt vom PC … (Stand ${fmtDate(res.cachedAt)})` : 'Der PC holt die Liste … (bis zu 2 Minuten, solange Orbit NAS am PC läuft)'));
    const { awaitJob } = await import('./sync.js');
    awaitJob(res.waiting).then((j) => { if (cur.loc === locId && cur.rel === rel && document.body.contains(listBox)) { if (j?.state === 'fehler') toast(j.message, 'err'); renderFiles(view, ['dateien', locId, rel]); } });
  }
  if (cur.search) runSearchPaint(); else paint();
}

function refresh(force = false) {
  if (force && locById(cur.loc)?.mode === 'remote') { listFolder(cur.loc, cur.rel, { refresh: true }).then(() => renderFiles(view, ['dateien', cur.loc, cur.rel])); return; }
  if (force) import('./sync.js').then((m) => m.sync({ force: true }).catch(() => {}));
  renderFiles(view, ['dateien', cur.loc, cur.rel]);
}

// ---------------------------------------------------------------- Orte-Karten

function locCard(l, on) {
  const card = h('button.loccard' + (on ? '.on' : ''), { onclick: () => go(filesHash(l.id)), oncontextmenu: (e) => { e.preventDefault(); locMenu(l); } },
    h('span.lic', { style: { background: `linear-gradient(135deg, ${l.grad[0]}, ${l.grad[1]})`, boxShadow: `0 0 18px ${l.grad[1]}80` } }, icon(l.kind === 'all' ? 'layers' : l.kind === 'cloud' ? 'cloud' : l.kind === 'storage' ? 'pc' : l.kind === 'disk' ? 'disk' : 'folder')),
    h('span.ltext', h('b', l.name), h('small.ltype', l.typeText),
      l.usedPct != null ? h('span.lbar', h('span', { style: { width: l.usedPct + '%', background: l.usedPct > 90 ? 'var(--warn)' : 'var(--accent)' } })) : null,
      h('small.lspace', l.spaceText || (l.mode === 'remote' ? 'Liste über den PC' : ''))));
  longPress(card, () => locMenu(l));
  return card;
}

function locMenu(l) {
  if (l.mode === 'all') return;
  const lk = lockFor(l.id, '');
  const rootLock = lk?.hash && lk.path === '';
  const conn = (state.status?.connections || []).find((c) => c.id === l.id);
  actionSheet(l.name, [
    { label: 'Öffnen', icon: 'folder', onclick: () => go(filesHash(l.id)) },
    '-',
    conn && { label: 'Verbindung testen', icon: 'sync', onclick: async () => { await viaPc('verbindungTesten', { connId: l.id }, `Verbindung „${l.name}“ testen`); } },
    conn && { label: 'Verbindung bearbeiten …', icon: 'edit', hint: 'Nur am PC (Zugangsdaten liegen dort)', disabled: true },
    conn?.canBePrimary && !conn.primary && { label: 'Als Haupt-Cloud verwenden', icon: 'star', onclick: () => viaPc('hauptCloud', { connId: l.id }, `„${l.name}“ als Haupt-Cloud`) },
    '-',
    !rootLock && { label: 'Mit PIN schützen …', icon: 'lock', onclick: () => protect({ location: l.id, rel: '', name: l.name }) },
    rootLock && { label: 'PIN-Schutz entfernen …', icon: 'lock', onclick: () => unprotect({ location: l.id, rel: '', name: l.name }) },
    { label: 'Speicher-Analyse', icon: 'chart', onclick: () => analysis(l.id, '') },
    '-',
    { label: 'Speicherort ändern / Ort entfernen …', icon: 'gear', hint: 'Nur am PC', disabled: true },
  ]);
}

// ---------------------------------------------------------------- Baum (iPad quer) und Favoriten

function favorites() {
  return (state.status?.favorites || []).filter((f) => locById(f.location));
}

function paintTree() {
  const tree = view?.querySelector('.tree');
  if (!tree) return;
  const favs = favorites();
  clear(tree).append(
    h('div.tree-sec', h('div.tree-head', icon('star', 'k-folder'), 'Favoriten'),
      favs.length ? favs.map((f) => h('button.tnode.fav', { onclick: () => openFavorite(f), oncontextmenu: (e) => { e.preventDefault(); favMenu(f); } }, glyphFor({ ...f, rel: f.path }), h('span', f.name))) : h('div.muted.small.pad', 'Noch keine – im Menü „Zu Favoriten hinzufügen“.')),
    h('div.tree-sep'),
    ...locations().map((l) => treeNode(l, '', l.name, 0)));
}

function treeNode(l, rel, name, depth) {
  const key = l.id + ':' + rel;
  const open = expanded.has(key);
  const isCur = cur.loc === l.id && cur.rel === rel;
  const locked = lockFor(l.id, rel)?.hash && !unlocked.has(l.id + ':' + lockFor(l.id, rel).path);
  const node = h('div.tgroup');
  const row = h('div.tnode' + (isCur ? '.on' : ''), { style: { paddingLeft: 6 + depth * 16 + 'px' } },
    h('button.tarrow', { 'aria-label': open ? 'Zuklappen' : 'Aufklappen', onclick: (e) => { e.stopPropagation(); open ? expanded.delete(key) : expanded.add(key); paintTree(); } }, icon(open ? 'chevronDown' : 'chevron')),
    depth === 0 ? h('span.lic.mini', { style: { background: `linear-gradient(135deg, ${l.grad[0]}, ${l.grad[1]})` } }, icon(l.kind === 'cloud' ? 'cloud' : l.kind === 'all' ? 'layers' : l.kind === 'storage' ? 'pc' : 'disk'))
      : glyphFor({ location: l.id, rel, isFolder: true, name }),
    h('span.tname', name));
  row.addEventListener('click', () => go(filesHash(l.id, rel)));
  node.append(row);
  if (open && !locked) {
    const kids = h('div.tkids');
    node.append(kids);
    treeChildren(l, rel).then((list) => {
      for (const c of list) kids.append(treeNode(l, c.rel, c.name, depth + 1));
    }).catch(() => {});
  }
  return node;
}

async function treeChildren(l, rel) {
  if (l.mode === 'all') return [];
  let items;
  if (l.mode === 'index') {
    const ix = state.index.find((x) => x.id === l.id);
    const i = ix ? (rel ? ix.find(rel) : -1) : null;
    if (i === null || !ix) return [];
    items = ix.children(i).filter((c) => ix.e[c][2] & 1).map((c) => ({ name: ix.e[c][1], rel: ix.pathOf(c), hidden: !!(ix.e[c][2] & 2), location: l.id }));
  } else if (l.mode === 'pcloud') {
    const { cache } = await import('./db.js');
    const c = await cache.get('list:/' + rel);
    items = c ? c.items.filter((x) => x.isFolder).map((x) => ({ name: x.name, rel: x.path.replace(/^\/+/, ''), location: l.id })) : (await listFolder(l.id, rel).catch(() => ({ items: [] }))).items.filter((x) => x.isFolder);
  } else {
    const { cache } = await import('./db.js');
    const c = await cache.get('liste:' + l.id + ':' + rel);
    items = c ? c.entries.filter((e) => e[1] & 1).map((e) => ({ name: e[0], rel: (rel ? rel + '/' : '') + e[0], location: l.id, hidden: !!(e[1] & 2) })) : [];
  }
  return items.filter((x) => !isIgnored(l.id, x.rel) && (settings.showHidden || !(x.hidden || isHidden(l.id, x.rel)))).sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
}

function favoritesSheet() {
  const favs = favorites();
  const body = h('div.actions');
  const s = sheet(body, { title: 'Favoriten' });
  if (!favs.length) body.append(h('p.muted.pad', 'Noch keine Favoriten. Im Menü eines Ordners oder einer Datei „Zu Favoriten hinzufügen“.'));
  for (const f of favs) {
    const b = h('button.action', { onclick: () => { s.close(); openFavorite(f); } }, glyphFor({ ...f, rel: f.path }), h('span', f.name, h('small', locName(f.location) + (f.path ? ' › ' + f.path.replace(/\//g, ' › ') : ''))));
    longPress(b, () => { s.close(); favMenu(f); });
    body.append(b);
  }
}
function favMenu(f) {
  actionSheet(f.name, [
    { label: 'Öffnen', icon: 'folder', onclick: () => openFavorite(f) },
    { label: 'Aus Favoriten entfernen', icon: 'star', onclick: async () => { await setFavorite({ ...f, rel: f.path }, false); paintTree(); } },
  ]);
}
async function openFavorite(f) {
  if (f.isFolder) { go(filesHash(f.location, f.path)); return; }
  const parent = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
  try {
    const r = await listFolder(f.location, parent);
    const it = r.items.find((x) => x.name === f.path.split('/').pop());
    if (it) openItem(it, r.items); else toast('Die Datei gibt es dort nicht mehr.', 'err');
  } catch (e) { toast(e.message, 'err'); }
}

// ---------------------------------------------------------------- Inhalt

function visibleItems() {
  const f = norm((cur.filter || '').trim());
  let items = cur.items.filter((it) => !ignoredItem(it) && (settings.showHidden || !hiddenItem(it)));
  if (f && !cur.search) items = items.filter((it) => norm(it.name).includes(f));
  const { by, dir } = settings.sort;
  const cmp = {
    name: (a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }),
    date: (a, b) => (a.mtime || 0) - (b.mtime || 0),
    type: (a, b) => typeName(a.name, kindOf(a.name, a.isFolder)).localeCompare(typeName(b.name, kindOf(b.name, b.isFolder)), 'de') || a.name.localeCompare(b.name, 'de'),
    size: (a, b) => (a.size || 0) - (b.size || 0),
  }[by] || ((a, b) => a.name.localeCompare(b.name));
  return items.sort((a, b) => (b.isFolder - a.isFolder) || dir * cmp(a, b));
}

/** Symbol eines Eintrags wie am PC: Ordnerfarbe/-symbol, Schloss bei PIN, sonst Dateiart-Farbe. */
function glyphFor(it, big = false) {
  const lk = it.isFolder && lockFor(it.location, it.rel);
  if (lk?.hash && lk.path.toLowerCase() === it.rel.toLowerCase()) return h('span.glyph' + (big ? '.big' : ''), { style: { color: '#F59E0B' } }, icon('lock'));
  if (it.isFolder) {
    const st = folderStyle(it.location, it.rel);
    const offloadedRoot = it.location === 'storage' && it.offloaded && managedFor(it.rel)?.path.toLowerCase() === it.rel.toLowerCase();
    return h('span.glyph' + (big ? '.big' : ''), { style: { color: st?.color || KIND_COLOR.folder } }, icon(st?.icon ? ICON_OF[st.icon] || 'folder' : offloadedRoot ? 'cloud' : 'folder'));
  }
  const k = kindOf(it.name);
  return h('span.glyph' + (big ? '.big' : ''), { style: { color: KIND_COLOR[k] } }, icon(kindIcon[k]));
}

function dotsFor(it) {
  const src = sourcesOf(it);
  if (src.length < 2 && !it.allView) return null;
  return h('span.dots', src.map((id) => h('i', { title: locName(id), style: { background: locById(id)?.color || '#94A3B8' } })));
}

function paint() {
  const listBox = view?.querySelector('.listbox');
  if (!listBox) return;
  const items = cur.search ? cur.search.results.filter((it) => settings.showHidden || !hiddenItem(it)) : visibleItems();
  cur.visible = items;
  paintSelbar();
  clear(listBox);
  if (cur.search) listBox.append(h('div.search-head', h('span', cur.search.busy ? `Suche „${cur.search.q}“ …` : `${items.length}${cur.search.more ? '+' : ''} Treffer für „${cur.search.q}“`),
    h('button.link', { onclick: () => { cur.search = null; cur.filter = ''; view.querySelector('.search').value = ''; paint(); } }, 'Suche beenden')));
  if (!items.length && !cur.search?.busy) {
    listBox.append(h('div.empty', icon('folder', 'big'), h('p', cur.search || cur.filter ? 'Nichts gefunden.' : cur.res?.waiting ? '' : 'Dieser Ordner ist leer.')));
  } else if (settings.tileView) {
    listBox.append(h('div.tiles', items.map(tile)));
  } else {
    const sortBy = (by) => { settings.sort = { by, dir: settings.sort.by === by ? -settings.sort.dir : 1 }; saveSettings(); paint(); };
    const arrow = (by) => (settings.sort.by === by ? (settings.sort.dir > 0 ? ' ▲' : ' ▼') : '');
    listBox.append(h('div.cols',
      h('button.c-name', { onclick: () => sortBy('name') }, 'Name' + arrow('name')), h('span.c-state', icon('cloud')),
      h('button.c-date', { onclick: () => sortBy('date') }, 'Geändert' + arrow('date')), h('button.c-type', { onclick: () => sortBy('type') }, 'Typ' + arrow('type')),
      h('button.c-size', { onclick: () => sortBy('size') }, 'Größe' + arrow('size'))),
    h('div.rows', items.map(row)));
  }
  paintStatus();
}

function stateGlyph(it) {
  const s = fileState(it.members ? it.members.find((m) => m.location === 'storage') || it : it);
  if (!s) return h('span.sglyph');
  const [ic, tone] = STATE_ICON[s];
  return h('span.sglyph.' + tone, { title: stateText(it.members?.find((m) => m.location === 'storage') || it) }, icon(ic));
}

function nameBits(it) {
  const mf = it.isFolder && it.location === 'storage' ? managedFor(it.rel) : null;
  const badge = mf && mf.path.toLowerCase() === it.rel.toLowerCase() ? BADGE[mf.mode] : '';
  return [h('span.nm', it.name), it.suffix ? h('span.suffix', '(' + it.suffix + ')') : null, badge ? h('span.badge', badge) : null,
    isFavorite(it) ? icon('star', 'favmark') : null,
    !it.allView && readOnlyFor(it.location, it.rel) && (readOnlyFor(it.location, it.rel).path || '').toLowerCase() === it.rel.toLowerCase() ? h('span.robadge', { title: 'Schreibgeschützt' }, icon('lock')) : null];
}

function rowHandlers(it, el) {
  const sel = cur.selected.has(it);
  el.classList.toggle('sel', sel);
  if (hiddenItem(it)) el.classList.add('dim');
  el.addEventListener('click', () => { if (cur.selecting) { sel ? cur.selected.delete(it) : cur.selected.add(it); paint(); } else openItem(it, cur.visible); });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); itemMenu(it); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openItem(it, cur.visible); });
  longPress(el, () => itemMenu(it));
}

function row(it) {
  const k = kindOf(it.name, it.isFolder);
  const el = h('div.frow', { tabindex: 0, role: 'button' },
    cur.selecting ? h('span.check' + (cur.selected.has(it) ? '.on' : ''), icon('check')) : null,
    h('span.c-name', h('span.gwrap', glyphFor(it), dotsFor(it)), h('span.nwrap', h('span.nline', nameBits(it)),
      h('span.subline', cur.search ? locName(it.location) + (it.rel.includes('/') ? ' › ' + it.rel.slice(0, it.rel.lastIndexOf('/')).replace(/\//g, ' › ') : '') : [fmtDate(it.mtime), it.isFolder ? '' : fmtSize(it.size)].filter(Boolean).join(' · ')))),
    stateGlyph(it),
    h('span.c-date', fmtDate(it.mtime)),
    h('span.c-type', typeName(it.name, k)),
    h('span.c-size', it.isFolder ? '' : fmtSize(it.size)),
    h('button.more', { 'aria-label': 'Menü', onclick: (e) => { e.stopPropagation(); itemMenu(it); } }, icon('more')));
  rowHandlers(it, el);
  return el;
}

function tile(it) {
  const thumb = it.kind === 'pcloud' && it.thumb && !it.isFolder ? thumbImg('img.tthumb', it.fileid, '256x256') : null;
  const el = h('div.tile', { tabindex: 0, role: 'button' },
    cur.selecting ? h('span.check' + (cur.selected.has(it) ? '.on' : ''), icon('check')) : null,
    h('span.tstate', stateGlyph(it)),
    h('span.tvisual', thumb || glyphFor(it, true)),
    dotsFor(it),
    h('span.tname', it.name, it.suffix ? h('small', ' (' + it.suffix + ')') : null));
  rowHandlers(it, el);
  return el;
}

function paintStatus() {
  const st = view?.querySelector('.fstatus');
  if (!st) return;
  const items = cur.visible || [];
  const folders = items.filter((x) => x.isFolder).length;
  const up = stats();
  clear(st).append(h('span', `${folders} Ordner, ${items.length - folders} Dateien` + (cur.selecting && cur.selected.size ? ` · ${cur.selected.size} ausgewählt` : '')),
    clipboard.items.length ? h('span.muted', ` · Zwischenablage: ${clipboard.items.length} (${clipboard.cut ? 'ausgeschnitten' : 'kopiert'})`) : null,
    h('span.spacer'),
    // Laufendes Hochladen zeigt die Vorgangsleiste unten; hier nur das Ergebnis, wenn alles fertig ist
    up.total && !up.active ? h('button.transfers', { onclick: transfersSheet }, icon('upload'), ` ${up.done} hochgeladen${up.skipped ? `, ${up.skipped} übersprungen` : ''}${up.failed ? `, ${up.failed} Fehler` : ''}`) : null);
}

function paintSelbar() {
  const bar = view?.querySelector('.selbar');
  if (!bar) return;
  clear(bar);
  bar.classList.toggle('show', cur.selecting);
  if (!cur.selecting) return;
  const sel = [...cur.selected];
  const n = sel.length;
  const canEdit = n && sel.every((it) => !it.allView && writable(it.location, it.rel));
  bar.append(
    h('button.btn.small', { onclick: () => { cur.selecting = false; cur.selected.clear(); paint(); } }, 'Fertig'),
    h('span.selcount', `${n} ausgewählt`),
    h('button.btn.small', { onclick: () => { cur.selected = new Set(cur.visible); paint(); } }, 'Alle'),
    h('span.spacer'),
    h('button.icon-btn', { title: 'Kopieren', disabled: !n, onclick: () => { setClipboard(sel, false); cur.selecting = false; renderFiles(view, ['dateien', cur.loc, cur.rel]); } }, icon('copy')),
    h('button.icon-btn', { title: 'Ausschneiden', disabled: !canEdit, onclick: () => { setClipboard(sel, true); cur.selecting = false; renderFiles(view, ['dateien', cur.loc, cur.rel]); } }, icon('cut')),
    h('button.icon-btn', { title: 'Herunterladen', disabled: !n || sel.some((x) => x.isFolder), onclick: async () => { for (const it of sel) await download(it); } }, icon('download')),
    h('button.icon-btn.danger', { title: 'Löschen', disabled: !canEdit, onclick: async () => { if (await remove(sel)) { cur.selecting = false; refresh(); } } }, icon('trash')));
}

// ---------------------------------------------------------------- Öffnen

function openItem(it, siblings) {
  if (it.isFolder) { go(filesHash(it.allView ? ALL : it.location, it.rel)); return; }
  openPlayer(it, (siblings || [it]).filter((x) => !x.isFolder), { onMenu: itemMenu });
}

// ---------------------------------------------------------------- Kontextmenü wie am PC

export function itemMenu(it, { fromPlayer = false } = {}) {
  const k = kindOf(it.name, it.isFolder);
  const all = !!it.allView;
  const w = !all && writable(it.location, it.rel);
  const parentW = !all && !readOnlyFor(it.location, it.rel) && writable(it.location, it.rel.includes('/') ? it.rel.slice(0, it.rel.lastIndexOf('/')) : '');
  const ro = !all && readOnlyFor(it.location, it.rel);
  const roRoot = ro && (ro.path || '').toLowerCase() === it.rel.toLowerCase();
  const hidden = hiddenItem(it);
  const fav = isFavorite(it);
  const lk = it.isFolder && lockFor(it.location, it.rel);
  const isLockRoot = lk?.hash && lk.path.toLowerCase() === it.rel.toLowerCase();
  const mf = !all && it.location === 'storage' && it.isFolder ? managedFor(it.rel) : null;
  const managedRoot = mf && mf.path.toLowerCase() === it.rel.toLowerCase() ? mf : null;
  const openLabel = it.isFolder ? 'Öffnen' : k === 'video' || k === 'audio' ? 'Abspielen' : k === 'image' ? 'Ansehen' : 'Öffnen';
  const parentRel = it.rel.includes('/') ? it.rel.slice(0, it.rel.lastIndexOf('/')) : '';
  actionSheet(it.name + (it.suffix ? ` (${it.suffix})` : ''), [
    { label: openLabel, icon: it.isFolder ? 'folder' : k === 'video' || k === 'audio' ? 'play' : 'eye', onclick: () => openItem(it, cur.visible) },
    (cur.search || it.allView || fromPlayer) && { label: fromPlayer ? 'Im Ordner zeigen' : 'Ordner öffnen, in dem es liegt', icon: 'folder', onclick: () => go(filesHash(it.allView ? ALL : it.location, parentRel)) },
    '-',
    !it.isFolder && { label: 'Herunterladen …', icon: 'download', hint: 'Teilen, „In Dateien sichern“ oder in einer anderen App öffnen', onclick: () => download(it) },
    canShareLink(it) && { label: 'Teilen-Link erstellen …', icon: 'share', hint: 'Öffentlicher Download-Link, z. B. für WhatsApp oder Mail', onclick: () => shareLink(it) },
    '-',
    parentW && { label: 'Ausschneiden', icon: 'cut', onclick: () => { setClipboard([it], true); paint(); paintStatus(); renderFiles(view, ['dateien', cur.loc, cur.rel]); } },
    { label: 'Kopieren', icon: 'copy', onclick: () => { setClipboard([it], false); renderFiles(view, ['dateien', cur.loc, cur.rel]); } },
    it.isFolder && w && clipboard.items.length && { label: 'Einfügen in diesen Ordner', icon: 'paste', onclick: async () => { if (await paste(it.location, it.rel)) refresh(); } },
    parentW && { label: 'Löschen', icon: 'trash', danger: true, onclick: async () => { if (await remove([it])) refresh(); } },
    '-',
    it.isFolder && w && { label: 'Neuer Ordner darin', icon: 'plusFolder', onclick: () => askNewFolder(it.location, it.rel) },
    parentW && { label: 'Umbenennen', icon: 'edit', onclick: () => askRename(it) },
    !all && { label: hidden ? 'Wieder sichtbar machen' : 'Verstecken', icon: hidden ? 'eye' : 'eyeOff', onclick: async () => { await setHidden([it], !hidden); paint(); paintTree(); } },
    it.isFolder && !all && { label: 'Dauerhaft ignorieren …', icon: 'ignore', hint: 'Aufheben nur unter Einstellungen → Ignorierte Ordner', onclick: () => askIgnore(it) },
    it.isFolder && !all && { label: 'Farbe und Symbol …', icon: 'palette', onclick: () => styleDialog(it) },
    '-',
    !all && { label: fav ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen', icon: 'star', onclick: async () => { await setFavorite(it, !fav); paint(); paintTree(); } },
    it.isFolder && !all && !isLockRoot && { label: 'Mit PIN schützen …', icon: 'lock', onclick: () => protect(it) },
    isLockRoot && { label: 'PIN-Schutz entfernen …', icon: 'lock', onclick: () => unprotect(it) },
    !all && !ro && { label: 'Schreibgeschützt', icon: 'lock', hint: 'Niemand kann es dann umbenennen, verschieben oder löschen', onclick: async () => { await setReadOnly(it, true); paint(); } },
    roRoot && { label: 'Schreibschutz aufheben', icon: 'edit', onclick: async () => { await setReadOnly(it, false); paint(); } },
    ro && !roRoot && { label: 'Schreibgeschützt über „' + (ro.path || locName(it.location)).split('/').pop() + '“', icon: 'lock', disabled: true },
    it.isFolder && { label: 'Speicher-Analyse', icon: 'chart', onclick: () => analysis(it.allView ? ALL : it.location, it.rel) },
    { label: 'Eigenschaften', icon: 'info', onclick: () => properties(it) },
    '-',
    managedRoot?.mode === 'Mirrored' && { label: 'Jetzt sichern', icon: 'shield', onclick: () => backupNow([managedRoot]) },
    managedRoot && managedRoot.mode !== 'CloudOnly' && (managedRoot.canOffload ?? (managedRoot.targets || []).length > 0) && { label: 'Auslagern (Platz freigeben)', icon: 'cloud', onclick: () => offload(managedRoot) },
    managedRoot?.mode === 'CloudOnly' && { label: 'Zurückholen auf den Speicher', icon: 'download', onclick: () => restore(managedRoot) },
    managedRoot && { label: 'Sicherung einstellen …', icon: 'gear', onclick: () => folderDialog({ folder: managedRoot }) },
    it.isFolder && !all && it.location === 'storage' && !mf && { label: 'Sichern oder auslagern …', icon: 'shield', onclick: () => folderDialog({ path: it.rel }) },
    '-',
    { label: 'Pfad kopieren', icon: 'path', onclick: () => copyPath(it) },
  ]);
}

function backgroundMenu() {
  actionSheet(locName(cur.loc) + (cur.rel ? ' › ' + cur.rel.split('/').pop() : ''), [
    writable(cur.loc, cur.rel) && clipboard.items.length && { label: 'Einfügen', icon: 'paste', onclick: async () => { if (await paste(cur.loc, cur.rel)) refresh(); } },
    writable(cur.loc, cur.rel) && { label: 'Neuer Ordner', icon: 'plusFolder', onclick: () => askNewFolder(cur.loc, cur.rel) },
    settings.showEyeButton !== false && { label: settings.showHidden ? 'Versteckte ausblenden' : 'Versteckte zeigen', icon: 'eye', onclick: () => { settings.showHidden = !settings.showHidden; saveSettings(); paint(); } },
    { label: settings.tileView ? 'Als Liste anzeigen' : 'Als Kacheln anzeigen', icon: settings.tileView ? 'list' : 'grid', onclick: () => { settings.tileView = !settings.tileView; saveSettings(); paint(); } },
    { label: 'Aktualisieren', icon: 'sync', onclick: () => refresh(true) },
  ]);
}

async function askNewFolder(locId, rel) {
  const name = await promptDialog('', 'Neuer Ordner', { title: 'Neuer Ordner', ok: 'Anlegen', select: (v) => v.length });
  if (!name) return;
  if (/[\\/:*?"<>|]/.test(name)) { toast('Der Name darf keines dieser Zeichen enthalten: \\ / : * ? " < > |', 'err'); return; }
  try { if ((await newFolder(locId, rel, name)) === 'direct') { toast('Ordner angelegt'); refresh(); } } catch (e) { toast(e.message, 'err'); }
}

async function askRename(it) {
  const dot = it.isFolder ? -1 : it.name.lastIndexOf('.');
  const name = await promptDialog('', it.name, { title: 'Umbenennen', ok: 'Umbenennen', select: (v) => (dot > 0 ? dot : v.length) });
  if (!name || name === it.name) return;
  if (/[\\/:*?"<>|]/.test(name)) { toast('Der Name darf keines dieser Zeichen enthalten: \\ / : * ? " < > |', 'err'); return; }
  try { if ((await rename(it, name)) === 'direct') { toast('Umbenannt'); refresh(); } } catch (e) { toast(e.message, 'err'); }
}

async function askIgnore(it) {
  if (!(await confirmDialog(`„${it.name}“ dauerhaft ignorieren? Der Ordner wird überall ausgeblendet – auch wenn „Versteckte zeigen“ an ist. Wieder sichtbar machen geht nur unter Einstellungen → „Ignorierte Ordner“.`, { title: 'Dauerhaft ignorieren', ok: 'Ignorieren' }))) return;
  await setIgnored(it, true);
  toast('Wird ab jetzt ignoriert');
  paint();
  paintTree();
}

function styleDialog(it) {
  const st = folderStyle(it.location, it.rel);
  let color = st?.color || null;
  let ic = st?.icon || null;
  const preview = h('span.style-preview');
  const paintPreview = () => clear(preview).append(h('span.glyph.big', { style: { color: color || KIND_COLOR.folder } }, icon(ic ? ICON_OF[ic] || 'folder' : 'folder')), h('b', it.name));
  const colors = h('div.swatches');
  const icons = h('div.iconpick');
  const paintPick = () => {
    colors.replaceChildren(...FOLDER_COLORS.map((c) => h('button.swatch' + ((color || KIND_COLOR.folder) === c ? '.on' : ''), { style: { background: c }, 'aria-label': c, onclick: () => { color = c === KIND_COLOR.folder ? null : c; paintPick(); paintPreview(); } })));
    const names = ['folder', 'star', 'heart', 'photo', 'music', 'video', 'doc', 'work', 'home', 'lock', 'cloud', 'archive'];
    icons.replaceChildren(...names.map((n) => h('button.ipick' + ((ic || 'folder') === n ? '.on' : ''), { 'aria-label': n, onclick: () => { ic = n === 'folder' ? null : n; paintPick(); paintPreview(); } }, icon(ICON_OF[n]))));
  };
  paintPick();
  paintPreview();
  const body = h('div.dialog-body', preview, h('div.label', 'Farbe'), colors, h('div.label', 'Symbol'), icons,
    h('div.btn-row',
      h('button.btn', { onclick: async () => { s.close(); await setFolderStyle(it, null, null); paint(); paintTree(); } }, 'Standard'),
      h('button.btn.primary', { onclick: async () => { s.close(); await setFolderStyle(it, color, ic); toast('Gespeichert – der PC übernimmt es'); paint(); paintTree(); } }, 'Übernehmen')));
  const s = sheet(body, { title: 'Farbe und Symbol' });
}

async function protect(it) {
  const r = await choosePin(`„${it.name}“ mit PIN schützen`, 'Die PIN gilt für alle Unterordner – am PC und auf allen Handys. Sie schützt vor fremden Blicken in Orbit NAS.');
  if (!r) return;
  await viaPc('pinSchutz', { location: it.location, path: it.rel, hash: r.hash, pinLength: r.length }, `PIN-Schutz für „${it.name}“`);
  await patchStatus((st) => { st.locks = (st.locks || []).filter((l) => !(l.location === it.location && l.path.toLowerCase() === it.rel.toLowerCase())); st.locks.push({ location: it.location, path: it.rel, hash: r.hash, pinLength: r.length }); });
  unlocked.add(it.location + ':' + it.rel);
  renderFiles(view, ['dateien', cur.loc, cur.rel]);
}

async function unprotect(it) {
  const lk = lockFor(it.location, it.rel);
  if (!lk?.hash) return;
  if (!(await askPin(`PIN für „${it.name}“`, lk.hash, lk.pinLength || 4))) return;
  if (!(await askSecurity('PIN abschalten'))) return;
  await viaPc('pinEntfernen', { location: it.location, path: it.rel }, `PIN-Schutz von „${it.name}“ entfernen`);
  await patchStatus((st) => { st.locks = (st.locks || []).filter((l) => !(l.location === it.location && l.path.toLowerCase() === it.rel.toLowerCase())); });
  renderFiles(view, ['dateien', cur.loc, cur.rel]);
}

async function copyPath(it) {
  const text = locName(it.location) + (it.rel ? ' › ' + it.rel.replace(/\//g, ' › ') : '');
  try { await navigator.clipboard.writeText(it.location === pcloudLocationId() ? '/' + it.rel : it.rel.replace(/\//g, '\\')); toast('Pfad kopiert: ' + text); }
  catch { toast(text); }
}

// ---------------------------------------------------------------- Eigenschaften

function properties(it) {
  const k = kindOf(it.name, it.isFolder);
  const members = it.members || [it];
  const rows = [
    ['Name', it.name], ['Typ', typeName(it.name, k)],
    ['Ort', members.map((m) => locName(m.location)).join(', ')],
    ['Pfad', it.rel ? it.rel.replace(/\//g, ' › ') : '(oberste Ebene)'],
    ['Größe', it.isFolder && !it.size ? '–' : `${fmtSize(it.size)} (${Math.round(it.size || 0).toLocaleString('de-DE')} Bytes)`],
    ['Geändert', fmtDate(it.mtime) || '–'],
  ];
  const stt = stateText(members.find((m) => m.location === 'storage') || it);
  if (stt) rows.push(['Status', stt]);
  if (hiddenItem(it)) rows.push(['Versteckt', 'ja']);
  const lk = lockFor(it.location, it.rel);
  if (lk?.hash) rows.push(['PIN-Schutz', lk.path ? 'über „' + lk.path + '“' : 'ganzer Ort']);
  if (it.isFolder && it.kind === 'index') {
    const ix = state.index.find((l) => l.id === it.location);
    let files = 0, folders = 0;
    const walk = (i) => { for (const c of ix.children(i)) { if (ix.e[c][2] & 1) { folders++; walk(c); } else files++; } };
    walk(it.idx);
    rows.push(['Inhalt', `${files.toLocaleString('de-DE')} Dateien, ${folders.toLocaleString('de-DE')} Ordner`]);
  }
  const src = sourcesOf(it);
  sheet(h('div.dialog-body', h('div.prop-head', glyphFor(it, true), h('b', it.name)),
    h('dl.props', rows.map(([a, b]) => [h('dt', a), h('dd', b)])),
    h('div.label', 'Liegt auf'), h('div.srclist', src.map((id) => h('span.src', h('i', { style: { background: locById(id)?.color } }), locName(id))))), { title: 'Eigenschaften' });
}

// ---------------------------------------------------------------- Speicher-Analyse

async function analysis(locId, rel) {
  const body = h('div.dialog-body.analysis', h('div.loading', h('div.spinner'), 'Rechne …'));
  sheet(body, { title: 'Speicher-Analyse', wide: true });
  try {
    let entries = [];   // { name, size, isFolder, rel }
    let files = [];
    const loc = locById(locId);
    if (loc.mode === 'index') {
      const ix = state.index.find((l) => l.id === locId);
      const i = rel ? ix.find(rel) : -1;
      const sizes = ix.sizes();
      entries = ix.children(i).map((c) => ({ name: ix.e[c][1], size: sizes[c], isFolder: !!(ix.e[c][2] & 1), rel: ix.pathOf(c) }));
      const walk = (p) => { for (const c of ix.children(p)) { if (ix.e[c][2] & 1) walk(c); else files.push({ name: ix.e[c][1], size: ix.e[c][3], rel: ix.pathOf(c) }); } };
      walk(i);
    } else if (loc.mode === 'pcloud') {
      const fid = await state.backend.folderId('/' + rel || '/');
      const all = await state.backend.tree(fid, '/' + rel);
      const base = rel ? rel.split('/').length : 0;
      const top = new Map();
      for (const x of all) {
        const r = x.path.replace(/^\/+/, '');
        const parts = r.split('/');
        const name = parts[base];
        if (!top.has(name)) top.set(name, { name, size: 0, isFolder: parts.length > base + 1 || x.isFolder, rel: parts.slice(0, base + 1).join('/') });
        if (!x.isFolder) { top.get(name).size += x.size; files.push({ name: x.name, size: x.size, rel: r }); }
      }
      entries = [...top.values()];
    } else {
      entries = (await listFolder(locId, rel)).items.map((x) => ({ name: x.name, size: x.size || 0, isFolder: x.isFolder, rel: x.rel }));
      files = entries.filter((x) => !x.isFolder);
    }
    entries = entries.filter((x) => !isIgnored(locId, x.rel));
    files = files.filter((x) => !isIgnored(locId, x.rel));
    entries.sort((a, b) => b.size - a.size);
    files.sort((a, b) => b.size - a.size);
    const total = entries.reduce((s, x) => s + x.size, 0) || 1;
    const max = entries[0]?.size || 1;
    clear(body).append(
      h('p.muted', `${locName(locId)}${rel ? ' › ' + rel.replace(/\//g, ' › ') : ''}: ${fmtSize(total)} in ${files.length.toLocaleString('de-DE')} Dateien`),
      h('h3', 'Größte Ordner und Dateien'),
      h('div.bars', entries.slice(0, 25).map((x) => h('button.barrow', { onclick: () => { if (x.isFolder) go(filesHash(locId, x.rel)); } },
        glyphFor({ ...x, location: locId }), h('span.bname', x.name), h('span.btrack', h('span', { style: { width: (x.size / max) * 100 + '%' } })), h('span.bval', fmtSize(x.size) + ' · ' + Math.round((x.size / total) * 100) + ' %')))),
      h('h3', 'Größte Dateien'),
      h('div.bars', files.slice(0, 20).map((x) => h('div.barrow', glyphFor({ ...x, location: locId, isFolder: false }), h('span.bname', x.name, h('small', x.rel.includes('/') ? x.rel.slice(0, x.rel.lastIndexOf('/')) : '')), h('span.bval', fmtSize(x.size))))));
  } catch (e) { clear(body).append(h('p.err-text', e.message)); }
}

// ---------------------------------------------------------------- Suche (Enter = auch Unterordner)

async function deepSearch(q) {
  if (!q) { cur.search = null; paint(); return; }
  const words = norm(q).split(/\s+/).filter(Boolean);
  const match = (n) => words.every((w) => norm(n).includes(w));
  cur.search = { q, results: [], busy: true };
  paint();
  const out = [];
  const limit = 500;
  const searchLoc = async (l, rel) => {
    if (lockFor(l.id, rel)?.hash && !unlocked.has(l.id + ':' + lockFor(l.id, rel).path)) return;
    if (l.mode === 'index') {
      const ix = state.index.find((x) => x.id === l.id);
      if (!ix) return;
      const prefix = rel ? rel.toLowerCase() + '/' : '';
      for (let i = 0; i < ix.e.length && out.length < limit; i++) {
        if (!match(ix.e[i][1])) continue;
        const p = ix.pathOf(i);
        if (prefix && !p.toLowerCase().startsWith(prefix)) continue;
        const it = { ...ix.item(i), rel: p, kind: 'index', pendingBackup: !!(ix.e[i][2] & 16) };
        if (isIgnored(l.id, p) || (lockFor(l.id, p)?.hash && !unlocked.has(l.id + ':' + lockFor(l.id, p).path))) continue;
        out.push(it);
      }
    } else if (l.mode === 'pcloud') {
      const fid = await state.backend.folderId('/' + rel || '/');
      const all = await state.backend.tree(fid, '/' + rel);
      for (const x of all) {
        if (out.length >= limit) break;
        const r = x.path.replace(/^\/+/, '');
        if (!match(x.name) || /(^|\/)\.(mobil|versionen|orbitnas|verschluesselt)(\/|$)/i.test(r) || isIgnored(l.id, r)) continue;
        out.push({ ...x, location: l.id, rel: r, kind: 'pcloud' });
      }
    }
  };
  try {
    const l = locById(cur.loc);
    if (l.mode === 'all') { for (const x of locations()) if (x.mode === 'index' || x.mode === 'pcloud') await searchLoc(x, cur.rel).catch(() => {}); }
    else if (l.mode === 'remote') toast('Bei diesem Ort sucht nur der PC. Gefiltert wird der geöffnete Ordner.');
    else await searchLoc(l, cur.rel);
  } catch (e) { toast(e.message, 'err'); }
  if (cur.search?.q !== q) return;
  out.sort((a, b) => (b.isFolder - a.isFolder) || (b.mtime - a.mtime));
  cur.search = { q, results: out, busy: false, more: out.length >= limit };
  paint();
}
function runSearchPaint() { paint(); }

// ---------------------------------------------------------------- Hochladen (Fotomediathek, Dateien)

function uploadMenu(locId, rel) {
  const pick = (accept) => {
    const inp = h('input', { type: 'file', multiple: true, accept: accept || null, hidden: true });
    inp.onchange = () => { const files = [...inp.files]; inp.remove(); if (files.length) startUpload(files, locId, rel); };
    document.body.append(inp);
    inp.click();
  };
  actionSheet('Hochladen nach ' + locName(locId) + (rel ? ' › ' + rel.split('/').pop() : ''), [
    { label: 'Fotos und Videos', icon: 'photos', hint: 'Aus der Fotomediathek', onclick: () => pick('image/*,video/*') },
    { label: 'Dateien', icon: 'folder', hint: 'Aus der App „Dateien“, auch iCloud Drive', onclick: () => pick('') },
    { label: 'Foto aufnehmen', icon: 'camera', onclick: () => pick('image/*;capture=camera') },
  ]);
}

function startUpload(files, locId, rel) {
  const label = locName(locId) + (rel ? ' › ' + rel.replace(/\//g, ' › ') : '');
  if (direct(locId, rel)) {
    addFiles(files, '/' + rel, { label });
  } else {
    // Ziel am PC/auf der FRITZ!NAS: erst in den Eingang in pCloud, dann verschiebt der PC die Datei an ihren Platz.
    const inbox = basePath() + '/.mobil/eingang/' + uid();
    addFiles(files, inbox, {
      label,
      after: (q) => sendJob('verschieben', { from: { location: pcloudLocationId(), path: inbox.replace(/^\/+/, '') + '/' + q.finalName }, to: { location: locId, folder: rel }, conflict: 'auto' }, `„${q.finalName}“ nach ${label}`),
    });
    toast('Wird hochgeladen; der PC legt die Dateien dann in den Ordner. Fortschritt unten in der Leiste.');
    return;
  }
  toast('Wird hochgeladen. Fortschritt unten in der Leiste.');
}

function transfersSheet() {
  const summary = h('div.up-summary');
  const list = h('div.uplist');
  const s = sheet(h('div.dialog-body', h('p.muted.small', 'Schon hochgeladene Fotos und Videos werden erkannt und übersprungen – auch von anderen Geräten. Bitte die App beim Hochladen geöffnet lassen; nach einer Unterbrechung geht es von selbst weiter.'), summary, list), { title: 'Übertragungen', onClose: () => off() });
  const paintQ = () => {
    const st = stats();
    const pct = st.bytes ? Math.round((st.loaded / st.bytes) * 100) : 100;
    clear(summary).append(h('div.meter', h('div.fill', { style: { width: pct + '%' } })),
      h('div.up-line', h('span', `${st.done} fertig · ${st.skipped} übersprungen${st.failed ? ` · ${st.failed} Fehler` : ''}${st.active ? ` · ${st.active} offen` : ''}`), h('span', `${fmtSize(st.loaded)} / ${fmtSize(st.bytes)}`)),
      !st.active && st.total ? h('button.link', { onclick: () => { clearFinished(); } }, 'Liste leeren') : null);
    clear(list).append(...[...queue].reverse().map((q) => {
      const p = q.total ? Math.round((q.loaded / q.total) * 100) : 0;
      const tone = { fertig: 'ok', übersprungen: 'muted', fehler: 'danger', läuft: 'accent', pausiert: 'warn' }[q.status] || 'muted';
      return h('div.uprow', glyphFor({ name: q.name, isFolder: false }),
        h('div.upname', h('b', q.finalName || q.name), h('small', h('span.dot.' + tone), ` ${q.status === 'läuft' ? p + ' %' : q.status} · ${fmtSize(q.total)} → ${q.label}${q.message ? ' · ' + q.message : ''}`),
          q.status === 'läuft' ? h('div.meter.thin', h('div.fill', { style: { width: p + '%' } })) : null),
        q.status === 'übersprungen' ? h('button.btn.small', { onclick: () => retry(q, true) }, 'Trotzdem') : null,
        q.status === 'fehler' ? h('button.btn.small', { onclick: () => retry(q) }, 'Nochmal') : null,
        ['wartet', 'läuft', 'pausiert', 'prüfe'].includes(q.status) ? h('button.icon-btn', { 'aria-label': 'Abbrechen', onclick: () => cancel(q) }, icon('close')) : null);
    }));
  };
  const off = onQueue(paintQ);
  paintQ();
  return s;
}

onQueue(() => { if (view && document.body.contains(view.querySelector('.fstatus'))) paintStatus(); });
onChange((w) => {
  if (!view || !document.body.contains(view.querySelector('.files'))) return;
  if (w === 'status' || w === 'sync') { paintTree(); }
});

// Tastatur am iPad: Strg/⌘ + C, X, V, Entf, F2
document.addEventListener('keydown', (e) => {
  if (!view || !document.body.contains(view.querySelector('.files')) || document.querySelector('.backdrop, .player') || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  const focused = cur.visible.find((_, i) => view.querySelectorAll('.frow, .tile')[i] === document.activeElement);
  const sel = cur.selecting && cur.selected.size ? [...cur.selected] : focused ? [focused] : [];
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'f') { e.preventDefault(); view.querySelector('.search')?.focus(); }
  else if (mod && e.key === 'c' && sel.length) { setClipboard(sel, false); paintStatus(); }
  else if (mod && e.key === 'x' && sel.length) { setClipboard(sel, true); paintStatus(); }
  else if (mod && e.key === 'v' && clipboard.items.length && writable(cur.loc, cur.rel)) paste(cur.loc, cur.rel).then((n) => n && refresh());
  else if (e.key === 'Delete' && sel.length) remove(sel).then((n) => n && refresh());
  else if (e.key === 'F2' && sel.length === 1) askRename(sel[0]);
  else if (e.key === 'Backspace' && cur.rel) go(filesHash(cur.loc, cur.rel.split('/').slice(0, -1).join('/')));
});

function longPress(el, fn) {
  let t = null;
  let fired = false;
  el.addEventListener('touchstart', () => { fired = false; t = setTimeout(() => { fired = true; navigator.vibrate && navigator.vibrate(10); fn(); }, 520); }, { passive: true });
  const stop = () => clearTimeout(t);
  el.addEventListener('touchmove', stop, { passive: true });
  el.addEventListener('touchend', (e) => { stop(); if (fired) e.preventDefault(); });
  el.addEventListener('click', (e) => { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } }, true);
}

export { glyphFor, transfersSheet };
