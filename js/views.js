// Ansichten „Suche“ und „Hochladen“.

import { h, icon, kindIcon, kindOf, fmtSize, fmtDate, toast, debounce, clear } from './util.js';
import { state, updateHandy, pcloudLocationId } from './sync.js';
import { settings, go, filesHash, route } from './ui.js';
import { search, searchFeatures, buildPcTree, loadPcTree, pcTreeAge } from './search.js';
import { openPreview, itemMenu, exportMenu, pickFolder } from './files.js';
import { queue, addFiles, onQueue, stats, clearFinished, cancel, retry } from './upload.js';

// ---------------------------------------------------------------- Suche

let lastQuery = '';
let lastFilter = 'alle';

export async function renderSearch(view) {
  const q = route().query.get('q');
  if (q != null) lastQuery = q;
  const input = h('input.input.big', { type: 'search', placeholder: 'Alles durchsuchen: Dateien, Ordner, Funktionen', value: lastQuery, enterkeyhint: 'search', autocapitalize: 'off', autocorrect: 'off' });
  const filters = h('div.chips');
  const info = h('div.search-info');
  const out = h('div.listbox');
  clear(view).append(h('div.page-head', h('h1', 'Suche')), input, filters, info, out);

  const F = [['alle', 'Alles'], ['bild', 'Fotos'], ['video', 'Videos'], ['dokument', 'Dokumente'], ['ordner', 'Ordner']];
  const paintFilters = () => clear(filters).append(F.map(([k, l]) => h('button.chip' + (lastFilter === k ? '.on' : ''), { onclick: () => { lastFilter = k; paintFilters(); run(); } }, l)));
  paintFilters();

  await loadPcTree();
  const paintInfo = (text) => {
    clear(info).append(h('small.muted', text || (pcTreeAge() === Infinity ? 'pCloud ist noch nicht eingelesen.' : `pCloud eingelesen ${fmtDate(Date.now() - pcTreeAge())}`) +
      (state.indexGenerated ? ` · PC-Liste ${fmtDate(state.indexGenerated)}` : '')),
    h('button.link', { onclick: refreshTree }, 'pCloud neu einlesen'));
  };
  const refreshTree = async () => {
    try {
      await buildPcTree((n, total, name) => paintInfo(`Lese pCloud ein … ${n}/${total} (${name})`));
      paintInfo();
      run();
    } catch (e) { toast(e.message, 'err'); paintInfo(); }
  };
  paintInfo();
  if (pcTreeAge() > 24 * 3600000 && navigator.onLine) refreshTree();

  function run() {
    lastQuery = input.value;
    history.replaceState(null, '', '#/suche' + (lastQuery ? '?q=' + encodeURIComponent(lastQuery) : ''));
    clear(out);
    if (!lastQuery.trim()) { out.append(h('div.empty', icon('search', 'big'), h('p', 'Tippe einen Namen, z. B. „Urlaub“, „pdf“ oder „Steuer 2025“.'))); return; }
    const feats = lastFilter === 'alle' ? searchFeatures(lastQuery) : [];
    if (feats.length) {
      out.append(h('h3', 'Funktionen'), h('div.list', feats.map((f) => h('button.item.row', { onclick: () => go(f.go) }, h('span.ficon', icon(f.icon)), h('div.iname', h('div.n', f.label))))));
    }
    const { results, more } = search(lastQuery, { filter: lastFilter, showHidden: settings.showHidden });
    out.append(h('div.res-head', h('h3', `${results.length}${more ? '+' : ''} Treffer`),
      results.length ? h('button.link', { onclick: () => exportMenu('Suche „' + lastQuery + '“', results.map((r) => ({ ...r, rel: r.rel ?? r.path.replace(/^\/+/, '') }))) }, icon('export'), ' Exportieren') : null));
    const list = h('div.list');
    for (const r of results) {
      const rel = r.source === 'pcloud' ? r.path.replace(/^\/+/, '') : r.path;
      const it = { ...r, rel };
      const kind = kindOf(r.name, r.isFolder);
      list.append(h('button.item.row', {
        onclick: () => (r.isFolder ? go(filesHash(r.location, rel)) : openPreview(it, [it])),
        oncontextmenu: (e) => { e.preventDefault(); itemMenu(it); },
      },
      r.source === 'pcloud' && r.thumb ? h('img.thumb', { src: state.backend.thumbUrl(r.fileid, '120x120'), loading: 'lazy', alt: '' }) : h('span.ficon.k-' + kind, icon(kindIcon[kind])),
      h('div.iname', h('div.n', r.name), h('div.m', `${r.locationName} · /${rel.split('/').slice(0, -1).join('/')}${r.isFolder ? '' : ' · ' + fmtSize(r.size)}`))));
    }
    out.append(list);
    if (more) out.append(h('p.muted.center', 'Es gibt mehr Treffer. Bitte genauer suchen.'));
  }
  input.addEventListener('input', debounce(run, 150));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  run();
  if (!lastQuery) setTimeout(() => input.focus(), 200);
}

// ---------------------------------------------------------------- Hochladen

let unsub = null;
export async function renderUpload(view) {
  if (unsub) unsub();
  const ziel = route().query.get('ziel');
  let target = ziel || state.handy.lastFolder?.path || '/Handy-Uploads';
  const targetBtn = h('button.target');
  const paintTarget = () => clear(targetBtn).append(icon('folder'), h('span', h('small', 'Zielordner in pCloud'), h('strong', target === '/' ? 'pCloud (oberste Ebene)' : target)), icon('back', 'flip'));
  paintTarget();
  targetBtn.onclick = async () => {
    const p = await pickFolder('Zielordner wählen', target);
    if (p == null) return;
    target = p;
    paintTarget();
    await updateHandy((hd) => { hd.lastFolder = { path: p, t: Date.now() }; });
  };

  const photoInput = h('input', { type: 'file', accept: 'image/*,video/*', multiple: true, hidden: true });
  const fileInput = h('input', { type: 'file', multiple: true, hidden: true });
  const take = (inp) => {
    const files = [...inp.files];
    inp.value = '';
    if (!files.length) return;
    updateHandy((hd) => { hd.lastFolder = { path: target, t: Date.now() }; });
    addFiles(files, target);
    toast(`${files.length} ${files.length === 1 ? 'Datei' : 'Dateien'} in der Warteschlange`);
  };
  photoInput.onchange = () => take(photoInput);
  fileInput.onchange = () => take(fileInput);

  const summary = h('div.up-summary');
  const list = h('div.list.uplist');
  clear(view).append(h('div.page-head', h('h1', 'Hochladen')), targetBtn,
    h('div.big-buttons',
      h('button.bigbtn', { onclick: () => photoInput.click() }, icon('photos'), h('strong', 'Fotomediathek'), h('small', 'Fotos und Videos auswählen')),
      h('button.bigbtn', { onclick: () => fileInput.click() }, icon('folder'), h('strong', 'Dateien'), h('small', 'Aus der App „Dateien“, auch FRITZ!NAS'))),
    photoInput, fileInput,
    h('p.muted.small', 'Schon hochgeladene Fotos und Videos werden erkannt und übersprungen – auch wenn sie von einem anderen Gerät kamen. Bitte die App beim Hochladen geöffnet lassen; bei Unterbrechung geht es automatisch weiter.'),
    summary, list);

  const paint = () => {
    const s = stats();
    clear(summary);
    if (s.total) {
      const pct = s.bytes ? Math.round((s.loaded / s.bytes) * 100) : 100;
      summary.append(h('div.progress', h('div.bar', { style: { width: pct + '%' } })),
        h('div.up-line', h('span', `${s.done} fertig · ${s.skipped} übersprungen${s.failed ? ` · ${s.failed} Fehler` : ''}${s.active ? ` · ${s.active} offen` : ''}`),
          h('span', `${fmtSize(s.loaded)} / ${fmtSize(s.bytes)}`)),
        !s.active ? h('button.link', { onclick: clearFinished }, 'Liste leeren') : null);
    }
    clear(list);
    for (const q of [...queue].reverse()) {
      const pct = q.total ? Math.round((q.loaded / q.total) * 100) : 0;
      const cls = { fertig: 'green', übersprungen: 'gray', fehler: 'red', läuft: 'blue', pausiert: 'amber' }[q.status] || 'gray';
      list.append(h('div.item.row.static',
        h('span.ficon.k-' + kindOf(q.name), icon(kindIcon[kindOf(q.name)])),
        h('div.iname', h('div.n', q.finalName || q.name),
          h('div.m', h('span.dot.' + cls), ` ${q.status === 'läuft' ? pct + ' %' : q.status} · ${fmtSize(q.total)}${q.message ? ' · ' + q.message : ''}`),
          q.status === 'läuft' ? h('div.progress.thin', h('div.bar', { style: { width: pct + '%' } })) : null),
        q.status === 'übersprungen' ? h('button.btn.small', { onclick: () => retry(q, true) }, 'Trotzdem') : null,
        q.status === 'fehler' ? h('button.btn.small', { onclick: () => retry(q) }, 'Nochmal') : null,
        ['wartet', 'läuft', 'pausiert', 'prüfe'].includes(q.status) ? h('button.icon-btn', { 'aria-label': 'Abbrechen', onclick: () => cancel(q) }, icon('close')) : null));
    }
  };
  unsub = onQueue(() => { if (document.body.contains(list)) paint(); else { unsub(); unsub = null; } });
  paint();
}

export { pcloudLocationId };
