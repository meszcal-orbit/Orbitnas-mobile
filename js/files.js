// Datei-Manager im Stil der App „Dateien“: Durchsuchen (alle Orte), Ordner, Zuletzt, Favoriten.
// Große Überschrift, Suchfeld, Liste oder Symbole, langes Drücken öffnet das Menü.

import { h, icon, kindOf, typeName, fmtSize, fmtDate, toast, sheet, actionSheet, confirmDialog, promptDialog, debounce, norm, clear, KIND_COLOR } from './util.js';
import { connections, connById, source, loadedSource } from './sources/registry.js';
import { relPath, joinPath, parentPath, baseName } from './sources/base.js';
import * as store from './store.js';
import { settings, saveSettings, go, dirHash } from './ui.js';
import { askPin, choosePin } from './lock.js';
import { askSecurity } from './secq.js';
import {
  keyOf, connName, srcColor, isEncrypted, isHidden, readOnlyFor, lockFor, isUnlocked, markUnlocked, folderStyle, isFavorite, writable, visible,
  cachedList, listFolder, glyph, thumbOrGlyph, recent, newFolder, rename, remove, paste, download, shareLink, errText,
  setHidden, setIgnored, setReadOnly, setFavorite, setFolderStyle, setLock, favorites, FOLDER_ICON, FOLDER_COLORS,
} from './fileops.js';
import { openPlayer } from './player.js';
import { pickFolder } from './picker.js';
import { addFiles } from './upload.js';
import { openAddCloud } from './addcloud.js';
import { fritzConfigured, openFritz } from './fritz.js';

let view = null;
let cur = { conn: null, path: '/', items: [], shown: [], filter: '', search: null, selecting: false, selected: new Set() };

// ---------------------------------------------------------------- Bausteine der Seite

/** Seitenkopf wie in iOS: Leiste mit Zurück und Knöpfen, darunter die große Überschrift. */
export function pageHead({ title, back = null, right = [], left = null }) {
  const small = h('span.nav-title', title);
  const bar = h('header.navbar',
    h('div.nav-left', back ? h('button.nav-back', { onclick: back.onclick }, icon('back'), h('span', back.label)) : left),
    small,
    h('div.nav-right', right));
  const big = h('h1.large-title', title);
  requestAnimationFrame(() => {
    const scroller = view;
    if (!scroller) return;
    const on = () => bar.classList.toggle('scrolled', scroller.scrollTop > big.offsetTop + big.offsetHeight - 50);
    scroller.onscroll = on;
    on();
  });
  return [bar, big];
}
export const navBtn = (ic, label, onclick) => h('button.nav-btn', { 'aria-label': label, title: label, onclick }, icon(ic));
const textBtn = (label, onclick, extra = '') => h('button.nav-text' + extra, { onclick }, label);

function searchField(placeholder, value, onInput, onEnter) {
  const inp = h('input', { type: 'search', placeholder, value, enterkeyhint: 'search', autocapitalize: 'off', autocorrect: 'off', spellcheck: false });
  inp.addEventListener('input', debounce(() => onInput(inp.value), 120));
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); onEnter && onEnter(inp.value.trim()); } });
  return h('div.searchfield', icon('search'), inp);
}

export function longPress(el, fn) {
  let t = null, fired = false, x = 0, y = 0;
  el.addEventListener('touchstart', (e) => { fired = false; x = e.touches[0].clientX; y = e.touches[0].clientY; t = setTimeout(() => { fired = true; navigator.vibrate && navigator.vibrate(10); fn(); }, 500); }, { passive: true });
  el.addEventListener('touchmove', (e) => { if (Math.hypot(e.touches[0].clientX - x, e.touches[0].clientY - y) > 8) clearTimeout(t); }, { passive: true });
  el.addEventListener('touchend', (e) => { clearTimeout(t); if (fired) e.preventDefault(); });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!fired) fn(); });
  el.addEventListener('click', (e) => { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } }, true);
}

const group = (title, ...rows) => h('section.group', title ? h('h2.group-title', title) : null, h('div.group-body', rows));
const subPath = (it) => connName(it.conn) + (parentPath(it.path) !== '/' ? ' › ' + parentPath(it.path).slice(1).replace(/\//g, ' › ') : '');

// ---------------------------------------------------------------- Durchsuchen (alle Orte)

export async function renderBrowse(el) {
  view = el;
  const conns = connections();
  const page = h('div.page.ios');
  clear(view).append(page);
  page.append(...pageHead({ title: 'Durchsuchen', right: [navBtn('plus', 'Cloud hinzufügen', () => openAddCloud())] }),
    searchField('Suchen in allen Orten', '', () => {}, (q) => { if (q) go('#/suche?q=' + encodeURIComponent(q)); }));
  const rows = conns.map((c) => {
    const space = h('small.row-sub', c.email || '');
    const row = h('button.row', { onclick: () => go(dirHash(c.id)) },
      h('span.srcicon', { style: { background: srcColor(c.id) } }, icon(c.type === 'demo' ? 'layers' : 'cloud')),
      h('span.row-main', h('span.row-title', c.name), space),
      lockFor(c.id, '/') ? icon('lock', 'row-mark') : null, icon('chevron', 'chev'));
    longPress(row, () => sourceMenu(c));
    source(c.id).then((s) => s.info()).then((me) => { if (me.total) space.textContent = `${fmtSize(me.used)} von ${fmtSize(me.total)} belegt`; }).catch(() => {});
    return row;
  });
  const fritz = await fritzConfigured();
  page.append(group('Orte', ...rows,
    h('button.row', { onclick: () => openFritz() }, h('span.srcicon', { style: { background: '#E2001A' } }, icon('disk')),
      h('span.row-main', h('span.row-title', 'FRITZ!NAS'), h('small.row-sub', fritz ? 'Über die App „Dateien“ (im WLAN zu Hause)' : 'Einrichten – Anleitung antippen')), icon('chevron', 'chev')),
    h('button.row.add', { onclick: () => openAddCloud() }, h('span.srcicon.plain', icon('plus')), h('span.row-main', h('span.row-title', 'Cloud hinzufügen')))));
  const favs = favorites();
  if (favs.length) page.append(group('Favoriten', ...favs.slice(0, 8).map(favRow)));
  if (!conns.length) page.append(h('p.muted.pad', 'Noch keine Cloud eingebunden. Tippe auf „Cloud hinzufügen“.'));
}

function favRow(f) {
  const it = { ...f, conn: f.conn };
  const row = h('button.row', { onclick: () => openFavorite(f) }, glyph(it), h('span.row-main', h('span.row-title', f.name), h('small.row-sub', subPath(it))), icon('chevron', 'chev'));
  longPress(row, () => actionSheet(f.name, [
    { label: 'Öffnen', icon: 'folder', onclick: () => openFavorite(f) },
    { label: 'Aus Favoriten entfernen', icon: 'star', onclick: async () => { await setFavorite(it, false); rerender(); } },
  ]));
  return row;
}

async function openFavorite(f) {
  if (f.isFolder) { go(dirHash(f.conn, f.path)); return; }
  try {
    const items = await listFolder(f.conn, parentPath(f.path));
    const it = items.find((x) => x.path.toLowerCase() === f.path.toLowerCase());
    if (it) openItem(it, [it]); else toast('Die Datei gibt es dort nicht mehr.', 'err');
  } catch (e) { toast(errText(e), 'err'); }
}

function sourceMenu(c) {
  const root = { name: c.name, isFolder: true, path: '/', conn: c.id };
  const lk = lockFor(c.id, '/');
  actionSheet(c.name, [
    { label: 'Öffnen', icon: 'folder', onclick: () => go(dirHash(c.id)) },
    { label: 'Farbe …', icon: 'palette', onclick: () => sourceColorDialog(c) },
    !lk && { label: 'Mit PIN schützen …', icon: 'lock', onclick: () => protect(root) },
    lk && lk.path === '' && { label: 'PIN-Schutz entfernen …', icon: 'lock', onclick: () => unprotect(root) },
    { label: 'Einstellungen dieser Cloud', icon: 'gear', onclick: () => go('#/einstellungen/cloud/' + c.id) },
  ]);
}

function sourceColorDialog(c) {
  const colors = ['#17BED0', '#0F6CBD', '#1FA463', '#0061FE', ...FOLDER_COLORS];
  const body = h('div.dialog-body', h('div.swatches', colors.map((col) => h('button.swatch', { style: { background: col }, 'aria-label': col, onclick: async () => { s.close(); if (c.key) await store.setSourceColor(c.key, col); rerender(); } }))),
    h('div.btn-row', h('button.btn', { onclick: async () => { s.close(); if (c.key) await store.setSourceColor(c.key, null); rerender(); } }, 'Standard')));
  const s = sheet(body, { title: 'Farbe für „' + c.name + '“' });
}

// ---------------------------------------------------------------- Ordner

export async function renderFolder(el, connId, path) {
  view = el;
  const conn = connById(connId);
  if (!conn) { go('#/orte', { replace: true }); return; }
  const changed = cur.conn !== connId || cur.path.toLowerCase() !== path.toLowerCase();
  if (changed) cur = { conn: connId, path, items: [], shown: [], filter: '', search: null, selecting: false, selected: new Set() };
  const name = path === '/' ? conn.name : baseName(path);
  const page = h('div.page.ios' + (cur.selecting ? '.selecting' : ''));
  clear(view).append(page);
  if (changed) view.scrollTop = 0;
  const back = path === '/' ? { label: 'Orte', onclick: () => go('#/orte') } : { label: parentPath(path) === '/' ? conn.name : baseName(parentPath(path)), onclick: () => go(dirHash(connId, parentPath(path))) };
  const canWrite = writable(connId, path);
  const right = cur.selecting
    ? [textBtn('Fertig', () => { cur.selecting = false; cur.selected.clear(); renderFolder(view, connId, path); }, '.bold')]
    : [canWrite ? navBtn('plus', 'Hinzufügen', () => addMenu(connId, path)) : null, navBtn('more', 'Mehr', () => folderMenu(connId, path))];
  page.append(...pageHead({ title: name, back: cur.selecting ? null : back, right, left: cur.selecting ? textBtn('Alle', () => { cur.selected = new Set(cur.shown); paint(); }) : null }),
    searchField('Suchen in „' + name + '“', cur.filter, (v) => { cur.filter = v; if (!v) cur.search = null; paint(); }, (q) => deepSearch(q)));
  const notices = h('div.notices');
  const listBox = h('div.listbox');
  page.append(notices, listBox, h('div.selbar' + (cur.selecting ? '.show' : '')));

  if (isEncrypted(path)) {
    listBox.append(h('div.empty', icon('lock', 'big warnc'), h('h3', 'Verschlüsselt'), h('p.muted', 'Inhalt und Namen sind verschlüsselt. Ansehen geht im Moment nur am PC in Orbit NAS.')));
    return;
  }
  const lk = lockFor(connId, path);
  if (lk && !isUnlocked(connId, lk)) {
    const lname = lk.path ? lk.path.split('/').pop() : conn.name;
    listBox.append(h('div.empty', icon('lock', 'big warnc'), h('p', `„${lname}“ ist mit einer PIN geschützt.`),
      h('button.btn.primary', { onclick: async () => { if (await askPin(`PIN für „${lname}“`, lk.hash, lk.pinLength || 4)) { markUnlocked(connId, lk); renderFolder(view, connId, path); } } }, 'Entsperren')));
    return;
  }
  if (readOnlyFor(connId, path)) notices.append(h('div.notice.soft', icon('lock'), 'Schreibgeschützt – hier kann nichts geändert werden.'));

  // Erst den Zwischenspeicher zeigen (sofort), dann frisch laden
  const c = changed ? await cachedList(connId, path) : null;
  if (c) { cur.items = c.items; paint(); } else if (changed || !cur.items.length) listBox.append(h('div.loading', h('div.spinner'), 'Lädt …'));
  else paint();
  try {
    const items = await listFolder(connId, path);
    if (cur.conn !== connId || cur.path !== path) return;
    cur.items = items;
    clear(notices);
    if (readOnlyFor(connId, path)) notices.append(h('div.notice.soft', icon('lock'), 'Schreibgeschützt – hier kann nichts geändert werden.'));
    paint();
  } catch (e) {
    if (cur.conn !== connId || cur.path !== path) return;
    if (c) { clear(notices).append(h('div.notice', icon('cloud'), (e.offline ? 'Offline' : errText(e)) + ` – Stand vom ${fmtDate(c.at)}`)); return; }
    clear(listBox).append(h('div.empty', icon('warn', 'big'), h('p', e.message), e.detail ? h('p.muted.small.detail', e.detail) : null,
      e.login ? h('button.btn.primary', { onclick: () => go('#/einstellungen/cloud/' + connId) }, 'Neu anmelden') : h('button.btn', { onclick: () => renderFolder(view, connId, path) }, 'Erneut versuchen')));
  }
}

function sorted(items) {
  const { by, dir } = settings.sort;
  const cmp = {
    name: (a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }),
    date: (a, b) => (a.mtime || 0) - (b.mtime || 0),
    size: (a, b) => (a.size || 0) - (b.size || 0),
    type: (a, b) => typeName(a.name, kindOf(a.name, a.isFolder)).localeCompare(typeName(b.name, kindOf(b.name, b.isFolder)), 'de') || a.name.localeCompare(b.name, 'de'),
  }[by] || ((a, b) => a.name.localeCompare(b.name));
  return items.sort((a, b) => (b.isFolder - a.isFolder) || dir * cmp(a, b));
}

function paint() {
  const listBox = view?.querySelector('.listbox');
  if (!listBox) return;
  let items;
  if (cur.search) items = cur.search.results;
  else {
    items = visible(cur.conn, cur.items);
    const f = norm(cur.filter.trim());
    if (f) items = items.filter((it) => norm(it.name).includes(f));
    items = sorted(items);
  }
  cur.shown = items;
  clear(listBox);
  if (cur.search) listBox.append(h('div.search-head', h('span', cur.search.busy ? `Suche „${cur.search.q}“ …` : `${items.length} Treffer für „${cur.search.q}“`), h('button.link', { onclick: () => { cur.search = null; paint(); } }, 'Beenden')));
  if (!items.length && !cur.search?.busy) listBox.append(h('div.empty', icon('folder', 'big'), h('p', cur.filter || cur.search ? 'Nichts gefunden.' : 'Dieser Ordner ist leer.')));
  else if (settings.tileView && !cur.search) listBox.append(h('div.grid', items.map(tile)));
  else listBox.append(h('div.group-body.list', items.map(row)));
  const folders = items.filter((x) => x.isFolder).length;
  if (items.length && !cur.search) listBox.append(h('p.foot-count', `${folders ? folders + (folders === 1 ? ' Ordner' : ' Ordner') : ''}${folders && items.length - folders ? ', ' : ''}${items.length - folders ? (items.length - folders) + (items.length - folders === 1 ? ' Objekt' : ' Objekte') : ''}`));
  paintSelbar();
}

function itemHandlers(it, el) {
  if (isHidden(it.conn, it)) el.classList.add('dim');
  if (cur.selected.has(it)) el.classList.add('sel');
  el.addEventListener('click', () => {
    if (cur.selecting) { cur.selected.has(it) ? cur.selected.delete(it) : cur.selected.add(it); el.classList.toggle('sel'); paintSelbar(); return; }
    openItem(it, cur.shown);
  });
  longPress(el, () => itemMenu(it));
}

function marks(it) {
  return [isFavorite(it.conn, it.path) ? icon('star', 'mark fav') : null,
    readOnlyFor(it.conn, it.path)?.path?.toLowerCase() === relPath(it.path).toLowerCase() ? icon('lock', 'mark') : null];
}

function row(it) {
  const sub = cur.search ? subPath(it) : [fmtDate(it.mtime), it.isFolder || it.google ? '' : fmtSize(it.size)].filter(Boolean).join(' · ');
  const el = h('div.row.file', { role: 'button', tabindex: 0 },
    cur.selecting ? h('span.check', icon('check')) : null,
    h('span.ficon', thumbOrGlyph(it, 'm')),
    h('span.row-main', h('span.row-title', h('span.nm', it.name), marks(it)), h('small.row-sub', isEncrypted(it.path) && it.isFolder ? 'Verschlüsselt – nur am PC lesbar' : sub)),
    cur.selecting ? null : h('button.more', { 'aria-label': 'Menü', onclick: (e) => { e.stopPropagation(); itemMenu(it); } }, icon('more')));
  itemHandlers(it, el);
  return el;
}

function tile(it) {
  const el = h('div.tile', { role: 'button', tabindex: 0 },
    h('span.tvisual', thumbOrGlyph(it, 'm', true), cur.selecting ? h('span.check', icon('check')) : null),
    h('span.tname', it.name, marks(it)),
    h('small.tsub', it.isFolder ? fmtDate(it.mtime, false) : fmtSize(it.size)));
  itemHandlers(it, el);
  return el;
}

function paintSelbar() {
  const bar = view?.querySelector('.selbar');
  if (!bar) return;
  clear(bar);
  if (!cur.selecting) return;
  const sel = [...cur.selected];
  const n = sel.length;
  const canEdit = n && sel.every((it) => writable(it.conn, it.path));
  bar.append(
    h('button.sb', { disabled: !n || sel.some((x) => x.isFolder), onclick: async () => { for (const it of sel) await download(it); } }, icon('share'), h('span', 'Teilen')),
    h('button.sb', { disabled: !n, onclick: () => moveOrCopy(sel, false) }, icon('copy'), h('span', 'Kopieren')),
    h('button.sb', { disabled: !canEdit, onclick: () => moveOrCopy(sel, true) }, icon('move'), h('span', 'Bewegen')),
    h('span.sb-count', n ? `${n} ausgewählt` : 'Objekte auswählen'),
    h('button.sb.danger', { disabled: !canEdit, onclick: async () => { if (await remove(sel)) { cur.selecting = false; cur.selected.clear(); renderFolder(view, cur.conn, cur.path); } } }, icon('trash'), h('span', 'Löschen')));
}

// ---------------------------------------------------------------- Öffnen, Menüs

export function openItem(it, siblings) {
  if (it.isFolder) { go(dirHash(it.conn, it.path)); return; }
  openPlayer(it, (siblings || [it]).filter((x) => !x.isFolder), { onMenu: itemMenu });
}

function rerender() { window.dispatchEvent(new HashChangeEvent('hashchange')); }

async function moveOrCopy(items, cut) {
  const target = await pickFolder(cut ? 'Bewegen nach' : 'Kopieren nach', { start: { conn: items[0].conn, path: parentPath(items[0].path) }, ok: cut ? 'Bewegen' : 'Kopieren' });
  if (!target) return;
  const n = await paste(target.conn, target.path, items, cut);
  if (n) toast(`${n === 1 ? '1 Eintrag' : n + ' Einträge'} ${cut ? 'bewegt' : 'kopiert'}${target.conn !== items[0].conn ? ' (wird übertragen, siehe Leiste unten)' : ''}`);
  cur.selecting = false;
  cur.selected.clear();
  rerender();
}

export function itemMenu(it, { fromPlayer = false, showFolder = false } = {}) {
  const k = kindOf(it.name, it.isFolder);
  const enc = isEncrypted(it.path);
  const w = writable(it.conn, it.path);
  const parentW = w && writable(it.conn, parentPath(it.path));
  const ro = readOnlyFor(it.conn, it.path);
  const roHere = ro && ro.path.toLowerCase() === relPath(it.path).toLowerCase();
  const hidden = isHidden(it.conn, it);
  const fav = isFavorite(it.conn, it.path);
  const lk = it.isFolder && lockFor(it.conn, it.path);
  const lockHere = lk && lk.path.toLowerCase() === relPath(it.path).toLowerCase();
  const src = loadedSource(it.conn);
  actionSheet(it.name, [
    { label: it.isFolder ? 'Öffnen' : k === 'video' || k === 'audio' ? 'Abspielen' : 'Ansehen', icon: it.isFolder ? 'folder' : k === 'video' || k === 'audio' ? 'play' : 'eye', onclick: () => openItem(it, it.isFolder ? null : cur.shown.includes(it) ? cur.shown : [it]) },
    (fromPlayer || showFolder || cur.search) && { label: 'Im Ordner zeigen', icon: 'folder', onclick: () => go(dirHash(it.conn, parentPath(it.path))) },
    '-',
    !it.isFolder && !enc && { label: 'Teilen / In „Dateien“ sichern …', icon: 'share', hint: 'Auch auf die FRITZ!NAS, AirDrop, Mail …', onclick: () => download(it) },
    src?.shareLink && !enc && { label: 'Teilen-Link erstellen …', icon: 'link', hint: 'Öffentlicher Link, z. B. für WhatsApp', onclick: () => shareLink(it) },
    '-',
    !enc && { label: 'Kopieren nach …', icon: 'copy', onclick: () => moveOrCopy([it], false) },
    parentW && { label: 'Bewegen nach …', icon: 'move', onclick: () => moveOrCopy([it], true) },
    parentW && { label: 'Umbenennen', icon: 'edit', onclick: () => askRename(it) },
    it.isFolder && w && { label: 'Neuer Ordner darin', icon: 'plusFolder', onclick: () => askNewFolder(it.conn, it.path) },
    '-',
    { label: fav ? 'Aus Favoriten entfernen' : 'Zu Favoriten', icon: 'star', onclick: async () => { await setFavorite(it, !fav); rerender(); } },
    it.isFolder && !enc && { label: 'Farbe und Symbol …', icon: 'palette', onclick: () => styleDialog(it) },
    { label: hidden ? 'Wieder sichtbar machen' : 'Verstecken', icon: hidden ? 'eye' : 'eyeOff', disabled: it.name.startsWith('.') && !store.entry('hidden', keyOf(it.conn), relPath(it.path)), onclick: async () => { await setHidden(it, !hidden); rerender(); } },
    it.isFolder && { label: 'Dauerhaft ignorieren …', icon: 'ignore', hint: 'Aufheben unter Einstellungen → Ignorierte Ordner', onclick: () => askIgnore(it) },
    it.isFolder && !enc && !lockHere && { label: 'Mit PIN schützen …', icon: 'lock', onclick: () => protect(it) },
    lockHere && { label: 'PIN-Schutz entfernen …', icon: 'lock', onclick: () => unprotect(it) },
    !ro && !enc && { label: 'Schreibgeschützt', icon: 'lock', hint: 'Dann kann es niemand ändern, bewegen oder löschen', onclick: async () => { await setReadOnly(it, true); rerender(); } },
    roHere && { label: 'Schreibschutz aufheben', icon: 'edit', onclick: async () => { await setReadOnly(it, false); rerender(); } },
    { label: 'Informationen', icon: 'info', onclick: () => properties(it) },
    '-',
    parentW && { label: 'Löschen', icon: 'trash', danger: true, onclick: async () => { if (await remove([it])) rerender(); } },
  ]);
}

function folderMenu(connId, path) {
  const w = writable(connId, path);
  const sortItem = (by, label) => ({ label: label + (settings.sort.by === by ? (settings.sort.dir > 0 ? '  ↑' : '  ↓') : ''), icon: 'sort', onclick: () => { settings.sort = { by, dir: settings.sort.by === by ? -settings.sort.dir : 1 }; saveSettings(); paint(); } });
  const it = { name: path === '/' ? connName(connId) : baseName(path), isFolder: true, path, conn: connId };
  actionSheet(it.name, [
    { label: 'Auswählen', icon: 'select', onclick: () => { cur.selecting = true; renderFolder(view, connId, path); } },
    '-',
    { label: settings.tileView ? 'Als Liste' : 'Als Symbole', icon: settings.tileView ? 'list' : 'grid', onclick: () => { settings.tileView = !settings.tileView; saveSettings(); paint(); } },
    sortItem('name', 'Nach Name'), sortItem('date', 'Nach Datum'), sortItem('size', 'Nach Größe'), sortItem('type', 'Nach Art'),
    store.showHiddenButton() && { label: settings.showHidden ? 'Versteckte ausblenden' : 'Versteckte zeigen', icon: settings.showHidden ? 'eyeOff' : 'eye', onclick: () => { settings.showHidden = !settings.showHidden; saveSettings(); paint(); } },
    '-',
    w && { label: 'Neuer Ordner', icon: 'plusFolder', onclick: () => askNewFolder(connId, path) },
    w && { label: 'Hochladen …', icon: 'upload', onclick: () => addMenu(connId, path) },
    { label: 'Aktualisieren', icon: 'sync', onclick: () => renderFolder(view, connId, path) },
    path !== '/' && { label: 'Mehr zu diesem Ordner …', icon: 'more', onclick: () => itemMenu(it) },
    { label: 'Speicher-Analyse', icon: 'chart', onclick: () => analysis(connId, path) },
  ]);
}

function addMenu(connId, path) {
  const pick = (accept, capture) => {
    const inp = h('input', { type: 'file', multiple: !capture, accept: accept || null, capture: capture || null, hidden: true });
    inp.onchange = () => { const files = [...inp.files]; inp.remove(); if (files.length) startUpload(files, connId, path); };
    document.body.append(inp);
    inp.click();
  };
  actionSheet('Hinzufügen', [
    { label: 'Fotos und Videos', icon: 'photos', hint: 'Aus der Fotomediathek', onclick: () => pick('image/*,video/*') },
    { label: 'Dateien', icon: 'folder', hint: 'Aus „Dateien“ – auch iCloud Drive und FRITZ!NAS', onclick: () => pick('') },
    { label: 'Foto oder Video aufnehmen', icon: 'camera', onclick: () => pick('image/*,video/*', 'environment') },
    '-',
    { label: 'Neuer Ordner', icon: 'plusFolder', onclick: () => askNewFolder(connId, path) },
  ]);
}

export function startUpload(files, connId, path) {
  addFiles(files, connId, path, { label: connName(connId) + (path !== '/' ? ' › ' + path.slice(1).replace(/\//g, ' › ') : '') });
  toast(files.length === 1 ? 'Wird hochgeladen – Fortschritt unten in der Leiste.' : `${files.length} Dateien werden hochgeladen – Fortschritt unten in der Leiste.`);
}

async function askNewFolder(connId, path) {
  const name = await promptDialog('', 'Neuer Ordner', { title: 'Neuer Ordner', ok: 'Anlegen', select: (v) => v.length });
  if (!name) return;
  try { await newFolder(connId, path, name); toast('Ordner angelegt'); rerender(); } catch (e) { toast(errText(e), 'err'); }
}

async function askRename(it) {
  const dot = it.isFolder ? -1 : it.name.lastIndexOf('.');
  const name = await promptDialog('', it.name, { title: 'Umbenennen', ok: 'Umbenennen', select: (v) => (dot > 0 ? dot : v.length) });
  if (!name || name === it.name) return;
  try { await rename(it, name); toast('Umbenannt'); rerender(); } catch (e) { toast(errText(e), 'err'); }
}

async function askIgnore(it) {
  if (!(await confirmDialog(`„${it.name}“ dauerhaft ignorieren? Der Ordner wird überall ausgeblendet (auch am PC), selbst wenn „Versteckte zeigen“ an ist. Wieder sichtbar machen: Einstellungen → Ignorierte Ordner.`, { title: 'Dauerhaft ignorieren', ok: 'Ignorieren' }))) return;
  await setIgnored(it.conn, it.path, true);
  toast('Wird ab jetzt ignoriert');
  rerender();
}

function styleDialog(it) {
  const st = folderStyle(it.conn, it.path);
  let color = st?.color || null;
  let ic = st?.icon || null;
  const preview = h('span.style-preview');
  const colors = h('div.swatches');
  const icons = h('div.iconpick');
  const paintAll = () => {
    clear(preview).append(h('span.glyph.big', { style: { color: color || KIND_COLOR.folder } }, icon(FOLDER_ICON[ic || 'folder'])), h('b', it.name));
    colors.replaceChildren(...FOLDER_COLORS.map((c) => h('button.swatch' + ((color || KIND_COLOR.folder) === c ? '.on' : ''), { style: { background: c }, 'aria-label': c, onclick: () => { color = c === KIND_COLOR.folder ? null : c; paintAll(); } })));
    icons.replaceChildren(...Object.keys(FOLDER_ICON).map((n) => h('button.ipick' + ((ic || 'folder') === n ? '.on' : ''), { 'aria-label': n, onclick: () => { ic = n === 'folder' ? null : n; paintAll(); } }, icon(FOLDER_ICON[n]))));
  };
  paintAll();
  const s = sheet(h('div.dialog-body', preview, h('div.label', 'Farbe'), colors, h('div.label', 'Symbol'), icons,
    h('div.btn-row',
      h('button.btn', { onclick: async () => { s.close(); await setFolderStyle(it, null, null); rerender(); } }, 'Standard'),
      h('button.btn.primary', { onclick: async () => { s.close(); await setFolderStyle(it, color, ic); toast('Gespeichert – gilt auch am PC'); rerender(); } }, 'Übernehmen'))), { title: 'Farbe und Symbol' });
}

async function protect(it) {
  const r = await choosePin(`„${it.name}“ mit PIN schützen`, 'Die PIN gilt für alle Unterordner – am PC und auf allen Geräten.');
  if (!r) return;
  await setLock(it.conn, it.path, r);
  markUnlocked(it.conn, { path: relPath(it.path) });
  rerender();
}

async function unprotect(it) {
  const lk = lockFor(it.conn, it.path);
  if (!lk) return;
  if (!(await askPin(`PIN für „${it.name}“`, lk.hash, lk.pinLength || 4))) return;
  if (!(await askSecurity('Ordner-PIN entfernen'))) return;
  await setLock(it.conn, it.path, null);
  rerender();
}

function properties(it) {
  const k = kindOf(it.name, it.isFolder);
  const lk = lockFor(it.conn, it.path);
  const ro = readOnlyFor(it.conn, it.path);
  const rows = [
    ['Art', isEncrypted(it.path) && it.isFolder ? 'Verschlüsselter Ordner' : typeName(it.name, k)],
    ['Ort', connName(it.conn)],
    ['Pfad', it.path === '/' ? '(oberste Ebene)' : it.path.slice(1).replace(/\//g, ' › ')],
    !it.isFolder && ['Größe', `${fmtSize(it.size)} (${Math.round(it.size || 0).toLocaleString('de-DE')} Bytes)`],
    ['Geändert', fmtDate(it.mtime) || '–'],
    isHidden(it.conn, it) && ['Versteckt', 'ja'],
    lk && ['PIN-Schutz', lk.path ? 'über „' + lk.path.split('/').pop() + '“' : 'ganzer Ort'],
    ro && ['Schreibschutz', ro.path ? 'über „' + ro.path.split('/').pop() + '“' : 'ganzer Ort'],
  ].filter(Boolean);
  sheet(h('div.dialog-body', h('div.prop-head', thumbOrGlyph(it, 'l', true), h('b', it.name)), h('dl.props', rows.map(([a, b]) => [h('dt', a), h('dd', b)]))), { title: 'Informationen' });
}

async function analysis(connId, path) {
  const body = h('div.dialog-body.analysis', h('div.loading', h('div.spinner'), 'Rechne … (große Ordner dauern etwas)'));
  sheet(body, { title: 'Speicher-Analyse', wide: true });
  try {
    const top = new Map();
    const files = [];
    const walk = async (p, topName, depth) => {
      if (depth > 12) return;
      for (const x of visible(connId, await listFolder(connId, p))) {
        const tn = topName || x.name;
        if (!top.has(tn)) top.set(tn, { name: x.name, size: 0, isFolder: x.isFolder, path: x.path, conn: connId });
        if (x.isFolder) await walk(x.path, tn, depth + 1);
        else { top.get(tn).size += x.size || 0; files.push({ ...x, conn: connId }); }
      }
    };
    await walk(path, null, 0);
    const entries = [...top.values()].sort((a, b) => b.size - a.size);
    files.sort((a, b) => b.size - a.size);
    const total = entries.reduce((s, x) => s + x.size, 0) || 1;
    const max = entries[0]?.size || 1;
    clear(body).append(
      h('p.muted', `${connName(connId)}${path !== '/' ? ' › ' + path.slice(1).replace(/\//g, ' › ') : ''}: ${fmtSize(total)} in ${files.length.toLocaleString('de-DE')} Dateien`),
      h('h3', 'Größte Ordner und Dateien'),
      h('div.bars', entries.slice(0, 25).map((x) => h('button.barrow', { onclick: () => { if (x.isFolder) go(dirHash(connId, x.path)); } },
        glyph(x), h('span.bname', x.name), h('span.btrack', h('span', { style: { width: (x.size / max) * 100 + '%' } })), h('span.bval', fmtSize(x.size) + ' · ' + Math.round((x.size / total) * 100) + ' %')))),
      h('h3', 'Größte Dateien'),
      h('div.bars', files.slice(0, 20).map((x) => h('div.barrow', glyph(x), h('span.bname', x.name, h('small', parentPath(x.path))), h('span.bval', fmtSize(x.size))))));
  } catch (e) { clear(body).append(h('p.err-text', errText(e))); }
}

// ---------------------------------------------------------------- Suche (Enter = auch Unterordner)

async function deepSearch(q) {
  if (!q) { cur.search = null; paint(); return; }
  cur.search = { q, results: [], busy: true };
  paint();
  try {
    const src = await source(cur.conn);
    let res;
    if (src.search) res = await src.search(cur.path, q);
    else res = [];
    const out = res.map((it) => ({ ...it, conn: cur.conn })).filter((it) => !/(^|\/)\.(orbitnas|mobil|versionen|verschluesselt)(\/|$)/i.test(it.path)
      && !it.path.split('/').some((_, i, a) => i > 0 && store.entry('ignored', keyOf(cur.conn), a.slice(1, i + 1).join('/')))
      && (settings.showHidden || !isHidden(cur.conn, it)) && !lockedPath(cur.conn, it.path));
    if (cur.search?.q !== q) return;
    cur.search = { q, results: out.sort((a, b) => (b.isFolder - a.isFolder) || (b.mtime - a.mtime)).slice(0, 500), busy: false };
  } catch (e) { toast(errText(e), 'err'); cur.search = null; }
  paint();
}
const lockedPath = (connId, path) => { const lk = lockFor(connId, path); return lk && !isUnlocked(connId, lk); };

/** Suche in allen Orten (von „Durchsuchen“ aus). */
export async function renderSearchAll(el, q) {
  view = el;
  const page = h('div.page.ios');
  clear(view).append(page);
  const results = h('div.listbox', h('div.loading', h('div.spinner'), 'Suche …'));
  page.append(...pageHead({ title: 'Suche', back: { label: 'Durchsuchen', onclick: () => go('#/orte') } }),
    searchField('Suchen in allen Orten', q, () => {}, (v) => { if (v) go('#/suche?q=' + encodeURIComponent(v), { replace: true }); }), results);
  const out = [];
  for (const c of connections()) {
    try {
      const src = await source(c.id);
      if (!src.search) continue;
      for (const it of await src.search('/', q)) {
        const x = { ...it, conn: c.id };
        if (/(^|\/)\.(orbitnas|mobil|versionen|verschluesselt)(\/|$)/i.test(x.path) || lockedPath(c.id, x.path) || (!settings.showHidden && isHidden(c.id, x))) continue;
        out.push(x);
      }
    } catch { /* eine Quelle nicht erreichbar: die anderen trotzdem zeigen */ }
  }
  cur = { ...cur, conn: null, search: { q, results: out }, shown: out, selecting: false, selected: new Set() };
  clear(results).append(out.length ? h('div.group-body.list', out.slice(0, 500).map((it) => {
    const el2 = h('div.row.file', { role: 'button' }, h('span.ficon', thumbOrGlyph(it)), h('span.row-main', h('span.row-title', h('span.nm', it.name)), h('small.row-sub', subPath(it))), it.isFolder ? icon('chevron', 'chev') : null);
    el2.addEventListener('click', () => openItem(it, out));
    longPress(el2, () => itemMenu(it, { showFolder: true }));
    return el2;
  })) : h('div.empty', icon('search', 'big'), h('p', `Nichts gefunden für „${q}“.`)));
}

// ---------------------------------------------------------------- Zuletzt und Favoriten

export async function renderRecent(el) {
  view = el;
  const page = h('div.page.ios');
  clear(view).append(page);
  const list = (await recent()).filter((r) => connById(r.conn));
  const items = list.map((r) => ({ ...r, isFolder: false }));
  page.append(...pageHead({ title: 'Zuletzt', right: items.length ? [textBtn('Leeren', async () => { const { kv } = await import('./db.js'); await kv.set('recent', []); renderRecent(view); })] : [] }));
  if (!items.length) { page.append(h('div.empty', icon('clock', 'big'), h('p', 'Hier erscheinen Dateien, die du zuletzt geöffnet hast.'))); return; }
  for (const c of new Set(items.map((x) => x.conn))) await source(c).catch(() => {});
  page.append(h('div.grid.recent', items.map((it) => {
    const el2 = h('div.tile', { role: 'button' }, h('span.tvisual', thumbOrGlyph(it, 'm', true)), h('span.tname', it.name), h('small.tsub', connName(it.conn)));
    el2.addEventListener('click', () => openPlayer(it, items, { onMenu: (x, o) => itemMenu(x, { ...o, showFolder: true }) }));
    longPress(el2, () => itemMenu(it, { showFolder: true }));
    return el2;
  })));
}

export async function renderFavorites(el) {
  view = el;
  const page = h('div.page.ios');
  clear(view).append(page);
  const favs = favorites();
  page.append(...pageHead({ title: 'Favoriten' }));
  if (!favs.length) { page.append(h('div.empty', icon('star', 'big'), h('p', 'Noch keine Favoriten. Lange auf einen Ordner oder eine Datei drücken → „Zu Favoriten“. Favoriten gelten auch am PC.'))); return; }
  page.append(h('div.group-body.list', favs.map(favRow)));
}

store.onStore(() => {
  // Neue Einstellungen vom PC (Farben, Versteckte …): Liste neu zeichnen, ohne neu zu laden
  if (view && document.body.contains(view.querySelector('.listbox')) && !document.querySelector('.backdrop, .player') && cur.conn) paint();
});

