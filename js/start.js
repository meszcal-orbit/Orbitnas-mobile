// Startseite mit Widgets. Am iPad quer stehen mehrere Bereiche nebeneinander.

import { h, icon, kindIcon, kindOf, fmtSize, fmtDate, fmtAgo, toast, confirmDialog, clear } from './util.js';
import { state, sendJob, openJobs, isDemo, pcloudLocationId } from './sync.js';
import { go, filesHash } from './ui.js';
import { favorites, openFavorite, itemMenu } from './files.js';
import { loadPcTree } from './search.js';

let pcloudSpace = null;
let pcloudSpaceAt = 0;

export async function renderStart(view) {
  const st = state.status;
  const grid = h('div.widgets');
  clear(view).append(h('div.page-head', h('h1', 'Übersicht'), h('span.muted', state.pairing?.pc ? 'Gekoppelt mit ' + state.pairing.pc : '')));
  if (isDemo()) view.append(h('div.notice', icon('info'), 'Beispieldaten – nichts davon ist echt. Mehr → Kopplung zum Koppeln mit dem PC.'));
  if (!st) view.append(h('div.notice', icon('pc'), 'Vom PC sind noch keine Daten da. Orbit NAS am PC öffnen (ab Version 0.5.1), dann hier nach unten ziehen oder kurz warten.'));
  view.append(grid);

  grid.append(backupWidget(st), spaceWidget(st), analysisWidget(), foldersWidget(st), favWidget(), jobsWidget(), uploadsWidget());
}

function widget(title, ic, body, action) {
  return h('section.widget', h('div.w-head', icon(ic), h('h2', title), action || null), body);
}

// ---------------------------------------------------------------- Sicherung

function backupWidget(st) {
  const body = h('div.w-body');
  if (!st) { body.append(h('p.muted', 'Noch keine Daten vom PC.')); return widget('Sicherung', 'shield', body); }
  const lb = st.lastBackup;
  const pcAge = Date.now() - Date.parse(st.generated);
  const ok = lb && lb.ok;
  body.append(
    h('div.big-status.' + (!lb ? 'gray' : ok ? 'green' : 'red'), icon(ok ? 'check' : 'warn'),
      h('div', h('strong', !lb ? 'Noch keine Sicherung' : ok ? 'Alles gesichert' : 'Letzte Sicherung mit Fehler'),
        h('small', lb ? fmtAgo(lb.time) + ' · ' + fmtDate(lb.time) : ''))),
    lb && !ok && lb.message ? h('p.err-text', lb.message) : null,
    st.running ? h('div.progress', h('div.bar', { style: { width: Math.round((st.running.progress || 0) * 100) + '%' } }), h('small', st.running.text)) : null,
    h('dl.mini', h('dt', 'Nächste'), h('dd', st.nextBackup ? fmtDate(st.nextBackup) : '–'),
      h('dt', 'PC zuletzt'), h('dd.' + (pcAge > 3 * 3600000 ? 'warn' : ''), fmtAgo(st.generated))),
    h('button.btn.primary.block', {
      onclick: async () => {
        if (!(await confirmDialog('Alle gespiegelten Ordner jetzt sichern? Der PC startet die Sicherung, sobald Orbit NAS dort läuft.', { ok: 'Jetzt sichern' }))) return;
        try { await sendJob('sichern', { folderIds: [] }, 'Alles sichern'); toast('Auftrag an den PC gesendet'); go('#/start'); } catch (e) { toast(e.message, 'err'); }
      },
    }, icon('shield'), ' Jetzt sichern'));
  return widget('Sicherung', 'shield', body);
}

// ---------------------------------------------------------------- Speicherplatz

function bar(label, used, total, ic, sub) {
  const pct = total ? Math.min(100, (used / total) * 100) : 0;
  return h('div.space',
    h('div.space-top', icon(ic), h('span.name', label), h('span.val', total ? `${fmtSize(used)} von ${fmtSize(total)}` : fmtSize(used))),
    h('div.meter', h('div.fill' + (pct > 90 ? '.red' : pct > 75 ? '.amber' : ''), { style: { width: pct + '%' } })),
    total ? h('small.muted', `${fmtSize(Math.max(0, total - used))} frei${sub ? ' · ' + sub : ''}`) : null);
}

function spaceWidget(st) {
  const body = h('div.w-body');
  const conn = pcloudLocationId();
  const locs = (st?.locations || []).filter((l) => l.id !== conn);
  const pcBox = h('div');
  body.append(pcBox);
  const paintPc = () => clear(pcBox).append(pcloudSpace ? bar('pCloud', pcloudSpace.used, pcloudSpace.total, 'cloud', 'live') : h('div.space', h('div.space-top', icon('cloud'), h('span.name', 'pCloud'), h('span.val.muted', 'lädt …'))));
  paintPc();
  if (Date.now() - pcloudSpaceAt > 60000) {
    state.backend.userinfo().then((u) => { pcloudSpace = u; pcloudSpaceAt = Date.now(); paintPc(); }).catch(() => {
      const l = (st?.locations || []).find((x) => x.id === conn);
      if (l) { pcloudSpace = { used: l.used, total: l.total }; paintPc(); }
    });
  }
  for (const l of locs) body.append(bar(l.name, l.used || 0, l.total || 0, l.kind === 'cloud' ? 'cloud' : l.kind === 'storage' ? 'pc' : 'disk', l.online === false ? 'nicht erreichbar' : ''));
  return widget('Speicher', 'chart', body);
}

// ---------------------------------------------------------------- Speicher-Analyse

function analysisWidget() {
  const body = h('div.w-body');
  const folders = [];
  const files = [];
  for (const loc of state.index) {
    const sizes = loc.sizes();
    for (const i of loc.children(-1)) if (loc.e[i][2] & 1) folders.push({ loc, i, size: sizes[i] });
    // die größten Dateien (einmal durchgehen, oberste 5 behalten)
    for (let i = 0; i < loc.e.length; i++) {
      const x = loc.e[i];
      if (x[2] & 1) continue;
      if (files.length < 5 || x[3] > files[files.length - 1].size) {
        files.push({ loc, i, size: x[3] });
        files.sort((a, b) => b.size - a.size);
        if (files.length > 5) files.pop();
      }
    }
  }
  folders.sort((a, b) => b.size - a.size);
  const top = folders.slice(0, 6);
  const max = top[0]?.size || 1;
  if (!top.length) body.append(h('p.muted', 'Noch keine Dateiliste vom PC.'));
  else {
    body.append(h('h3', 'Größte Ordner'));
    for (const f of top) {
      body.append(h('button.abar', { onclick: () => go(filesHash(f.loc.id, f.loc.pathOf(f.i))) },
        h('span.n', f.loc.e[f.i][1], h('small', ' · ' + f.loc.name)), h('span.v', fmtSize(f.size)),
        h('span.track', h('span.fill', { style: { width: Math.max(3, (f.size / max) * 100) + '%' } }))));
    }
    body.append(h('h3', 'Größte Dateien'));
    for (const f of files) {
      const it = f.loc.item(f.i);
      body.append(h('button.frow', { onclick: () => itemMenu({ ...it, source: 'index', locationName: f.loc.name, rel: it.path }) },
        icon(kindIcon[kindOf(it.name)]), h('span.n', it.name), h('span.v', fmtSize(it.size))));
    }
  }
  loadPcTree().then((t) => {
    if (!t) return;
    const conn = pcloudLocationId();
    const top = t.items.filter((x) => !x.path.slice(1).includes('/') && x.isFolder);
    const sums = new Map(top.map((x) => [x.path, 0]));
    for (const x of t.items) if (!x.isFolder) { const k = '/' + x.path.split('/')[1]; if (sums.has(k)) sums.set(k, sums.get(k) + x.size); }
    const list = [...sums.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
    if (!list.length) return;
    body.append(h('h3', 'pCloud (ohne Sicherungen)'));
    const m = list[0][1];
    for (const [p, s] of list) {
      body.append(h('button.abar', { onclick: () => go(filesHash(conn, p.slice(1))) }, h('span.n', p.slice(1)), h('span.v', fmtSize(s)),
        h('span.track', h('span.fill.alt', { style: { width: Math.max(3, (s / m) * 100) + '%' } }))));
    }
  });
  return widget('Speicher-Analyse', 'chart', body);
}

// ---------------------------------------------------------------- Ordner und Sicherungsart

const MODE = { DiskOnly: 'Nur Platte', Mirrored: 'Gespiegelt', CloudOnly: 'Nur Cloud' };
function foldersWidget(st) {
  const body = h('div.w-body');
  const list = st?.folders || [];
  if (!list.length) body.append(h('p.muted', 'Keine verwalteten Ordner.'));
  const names = Object.fromEntries((st?.locations || []).map((l) => [l.id, l.name]));
  for (const f of list) {
    const state_ = f.lastError ? 'red' : f.mode === 'DiskOnly' ? 'gray' : f.mode === 'CloudOnly' ? 'blue' : 'green';
    body.append(h('button.frow', { onclick: () => go(filesHash('storage', f.path.replace(/\\/g, '/'))) },
      h('span.dot.' + state_), h('span.n', f.name, h('small', MODE[f.mode] + ((f.targets || []).length ? ' → ' + f.targets.map((t) => names[t] || t).join(', ') : ''))),
      h('span.v', f.lastSuccess ? fmtAgo(f.lastSuccess) : '–')));
  }
  return widget('Ordner', 'folder', body);
}

// ---------------------------------------------------------------- Favoriten

function favWidget() {
  const body = h('div.w-body');
  const favs = favorites();
  if (!favs.length) body.append(h('p.muted', 'Noch keine Favoriten. In „Dateien“ bei einem Eintrag auf ⋯ → „Zu Favoriten“.'));
  for (const f of favs) {
    body.append(h('button.frow', { onclick: () => openFavorite(f) }, icon(f.isFolder ? 'folder' : kindIcon[kindOf(f.name)]),
      h('span.n', f.name, h('small', f.from === 'pc' ? 'vom PC' : '')), icon('star', 'tiny gold')));
  }
  return widget('Favoriten', 'star', body);
}

// ---------------------------------------------------------------- Aufträge

const JOB_STATE = { gesendet: 'Wartet auf den PC', laeuft: 'Läuft', fertig: 'Erledigt', fehler: 'Fehler' };
export function jobRow(j) {
  const cls = j.state === 'fertig' ? 'green' : j.state === 'fehler' ? 'red' : j.state === 'laeuft' ? 'blue' : 'gray';
  return h('div.frow.static', h('span.dot.' + cls),
    h('span.n', j.label || j.type, h('small', `${JOB_STATE[j.state] || j.state} · ${fmtAgo(j.updated || j.created)}${j.message ? ' · ' + j.message : ''}`)),
    j.state === 'laeuft' && j.progress ? h('span.v', Math.round(j.progress * 100) + ' %') : null,
    j.pickup ? h('button.btn.small', { onclick: () => go(filesHash(pcloudLocationId(), j.pickup.replace(/^\/+/, '').split('/').slice(0, -1).join('/'))) }, 'Öffnen') : null);
}
function jobsWidget() {
  const body = h('div.w-body');
  const jobs = state.jobs.slice(0, 5);
  if (!jobs.length) body.append(h('p.muted', 'Keine Aufträge. Aufträge schickst du z. B. mit „Jetzt sichern“.'));
  jobs.forEach((j) => body.append(jobRow(j)));
  const open = openJobs().length;
  return widget('Aufträge an den PC', 'task', body, h('button.link', { onclick: () => go('#/mehr/auftraege') }, open ? `${open} offen` : 'Alle'));
}

// ---------------------------------------------------------------- Zuletzt hochgeladen

function uploadsWidget() {
  const body = h('div.w-body');
  const ups = Object.values(state.handy.uploads || {}).sort((a, b) => Date.parse(b.t) - Date.parse(a.t)).slice(0, 6);
  if (!ups.length) body.append(h('p.muted', 'Noch nichts hochgeladen.'));
  for (const u of ups) {
    body.append(h('button.frow', { onclick: () => go(filesHash(pcloudLocationId(), u.p.replace(/^\/+/, ''))) },
      icon(kindIcon[kindOf(u.n)]), h('span.n', u.n, h('small', `${u.p} · ${u.d || ''}`)), h('span.v', fmtAgo(u.t))));
  }
  return widget('Zuletzt hochgeladen', 'upload', body, h('button.link', { onclick: () => go('#/hochladen') }, 'Hochladen'));
}
