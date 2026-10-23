// Seite „Sicherung“ wie am PC: Vorgänge, Verbindungen, Ordner – und der Dialog „Ordner hinzufügen“.

import { h, icon, toast, sheet, actionSheet, confirmDialog, fmtAgo, clear } from './util.js';
import { state, sendJob, awaitJob, openJobs, isDemo, patchStatus } from './sync.js';
import { locName, viaPc } from './locations.js';
import { go, filesHash } from './ui.js';

const MODE = {
  DiskOnly: { text: 'Nur Platte', icon: 'disk', desc: 'Bleibt nur auf dem Speicher. Keine Cloud.' },
  Mirrored: { text: 'Gespiegelt', icon: 'layers', desc: 'Auf dem Speicher und als Kopie an den gewählten Zielen.' },
  CloudOnly: { text: 'Nur Cloud', icon: 'cloud', desc: 'Ausgelagert. Spart Platz, jederzeit zurückholbar.' },
};
const TONE = { Ok: 'ok', Warn: 'warn', Danger: 'danger', Muted: 'muted', Accent: 'accent' };

// ---------------------------------------------------------------- Aktionen (auch aus dem Datei-Manager)

export async function backupNow(folders) {
  const all = !folders || !folders.length;
  const label = all ? 'Alle sichern' : folders.length === 1 ? `„${folders[0].name}“ sichern` : `${folders.length} Ordner sichern`;
  await viaPc('sichern', { folderIds: all ? [] : folders.map((f) => f.id) }, label);
}

export async function offload(f) {
  await viaPc('auslagern', { folderId: f.id }, `„${f.name}“ auslagern`, {
    ask: `„${f.name}“ auslagern (Platz freigeben)? Der PC prüft zuerst, dass alles vollständig an den Zielen liegt, und entfernt die Dateien erst dann vom Speicher. Zurückholen geht jederzeit.`,
  });
}

export async function restore(f) {
  await viaPc('zurueckholen', { folderId: f.id }, `„${f.name}“ zurückholen`, {
    ask: `„${f.name}“ zurück auf den Speicher holen? Dafür muss auf dem Speicher genug Platz sein.`,
  });
}

/** Dialog wie am PC (FolderDialog): neuen Ordner sichern oder die Sicherung eines Ordners einstellen. */
export function folderDialog({ folder = null, path = '' } = {}) {
  const conns = state.status?.connections || (state.status?.locations || []).filter((l) => l.kind === 'cloud' || l.kind === 'disk').map((l) => ({ id: l.id, name: l.name, typeText: l.type, primary: l.primary }));
  let mode = folder?.mode || 'Mirrored';
  const chosen = new Set(folder ? folder.targets || [] : conns.filter((c) => c.primary).map((c) => c.id));
  const pathIn = h('input.input', { value: folder?.path || path, placeholder: 'z. B. Fotos', disabled: !!folder, autocapitalize: 'off' });
  const nameIn = h('input.input', { value: folder?.name || (path ? path.split('/').pop() : ''), placeholder: 'Anzeigename' });
  const err = h('p.err-text');
  const modes = h('div.radios');
  const targets = h('div.checks');
  const paintModes = () => modes.replaceChildren(...Object.entries(MODE).map(([k, m]) => h('label.radio' + (mode === k ? '.on' : ''),
    h('input', { type: 'radio', name: 'mode', checked: mode === k, onchange: () => { mode = k; paintModes(); paintTargets(); } }),
    h('span', h('b', m.text), h('small', m.desc)))));
  const paintTargets = () => targets.replaceChildren(
    h('div.label', 'Hierhin sichern (eins oder mehrere: Cloud, FRITZ!Box-Festplatte oder beides)'),
    ...conns.map((c) => h('label.check' + (mode === 'DiskOnly' ? '.dim' : ''),
      h('input', { type: 'checkbox', checked: chosen.has(c.id), disabled: mode === 'DiskOnly', onchange: (e) => { e.target.checked ? chosen.add(c.id) : chosen.delete(c.id); } }),
      h('span', `${c.name}  (${c.typeText || ''}${c.primary ? ', Haupt-Cloud' : ''})`))));
  paintModes();
  paintTargets();
  const pickBtn = folder ? null : h('button.btn', { type: 'button', onclick: async () => { const p = await pickStorageFolder(); if (p != null) { pathIn.value = p; if (!nameIn.value) nameIn.value = p.split('/').pop(); } } }, 'Auswählen …');
  const body = h('form.dialog-body.form', { onsubmit: (e) => { e.preventDefault(); save(); } },
    h('div.label', 'Ordner auf dem Speicher'), h('div.row-input', pathIn, pickBtn),
    h('div.label', 'Anzeigename'), nameIn,
    h('div.label', 'Modus'), modes, targets, err,
    h('div.btn-row', h('button.btn', { type: 'button', onclick: () => s.close() }, 'Abbrechen'), h('button.btn.primary', { type: 'submit' }, 'Speichern')));
  const s = sheet(body, { title: folder ? 'Sicherung einstellen' : 'Ordner hinzufügen' });

  async function save() {
    const p = pathIn.value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const name = nameIn.value.trim() || p.split('/').pop();
    const t = mode === 'DiskOnly' ? [] : [...chosen];
    if (!p) { err.textContent = 'Bitte einen Ordner auf dem Speicher angeben.'; return; }
    if (mode !== 'DiskOnly' && !t.length) { err.textContent = 'Bitte mindestens ein Ziel auswählen (z. B. deine Haupt-Cloud).'; return; }
    s.close();
    if (folder) await viaPc('ordnerBearbeiten', { folderId: folder.id, name, mode, targets: t }, `Sicherung von „${name}“ einstellen`);
    else await viaPc('ordnerHinzufuegen', { path: p, name, mode, targets: t }, `Ordner „${name}“ hinzufügen`);
  }
}

/** Ordner auf dem Speicher auswählen (aus der Liste vom PC). */
function pickStorageFolder() {
  return new Promise((resolve) => {
    const ix = state.index.find((l) => l.id === 'storage');
    if (!ix) { toast('Vom PC ist noch keine Liste des Speichers da.', 'err'); resolve(null); return; }
    let done = false;
    let cur = -1;
    const list = h('div.picker-list');
    const head = h('div.picker-head');
    const ok = h('button.btn.primary', { onclick: () => { done = true; s.close(); resolve(cur < 0 ? '' : ix.pathOf(cur)); } }, 'Diesen Ordner');
    const s = sheet(h('div.picker', head, list, h('div.btn-row', ok)), { title: 'Ordner auf dem Speicher', onClose: () => { if (!done) resolve(null); } });
    const load = (i) => {
      cur = i;
      ok.disabled = i < 0;
      clear(head).append(i >= 0 ? h('button.icon-btn', { 'aria-label': 'Zurück', onclick: () => load(ix.e[i][0]) }, icon('back')) : null,
        h('div.picker-path', locName('storage') + (i >= 0 ? ' › ' + ix.pathOf(i).replace(/\//g, ' › ') : '')));
      clear(list).append(...ix.children(i).filter((c) => ix.e[c][2] & 1).map((c) =>
        h('button.prow', { onclick: () => load(c) }, icon('folder', 'k-folder'), h('span', ix.e[c][1]), icon('chevron'))));
      if (!list.children.length) list.append(h('div.empty.small', 'Keine Unterordner'));
    };
    load(-1);
  });
}

// ---------------------------------------------------------------- Seite

export function renderBackup(view) {
  const st = state.status;
  const dev = st?.device;
  clear(view).append(h('div.page.backup',
    h('div.page-head',
      h('div', h('h1', 'Sicherung'), h('p.sub', st?.backupDeviceText || 'Noch kein Gerät für automatische Sicherungen festgelegt (Einstellungen).')),
      h('div.head-actions',
        h('button.btn', { onclick: () => backupNow(null) }, icon('shield'), ' Alle sichern'),
        h('button.btn.primary', { onclick: () => folderDialog() }, icon('plus'), ' Ordner hinzufügen'))),
    banners(st, dev),
    operations(st),
    h('div.backup-grid',
      h('section.col-conn', h('div.col-head', h('h2', 'Verbindungen'), h('button.icon-btn', { title: 'Verbindung hinzufügen', onclick: addConnectionInfo }, icon('plus'))),
        ...(st?.connections || []).map(connCard),
        !(st?.connections || []).length ? h('p.muted', st ? 'Der PC hat noch keine Verbindungen gemeldet (ab Orbit NAS 0.5.2).' : 'Noch keine Daten vom PC.') : null),
      h('section.col-folders', h('div.col-head', h('h2', 'Ordner')),
        ...(st?.folders || []).map(folderCard),
        !(st?.folders || []).length ? h('div.empty-card', h('p', 'Noch keine Ordner. Mit „Ordner hinzufügen“ legst du fest, was gesichert wird.')) : null))));
}

function banners(st, dev) {
  const out = [];
  if (!st) out.push(h('div.banner.warn', icon('pc'), h('span', 'Vom PC sind noch keine Daten da. Orbit NAS am PC öffnen, dann kommt alles in ein bis zwei Minuten.')));
  if (dev && dev.storageOk === false) out.push(h('div.banner.danger', icon('warn'), h('span', h('b', 'Speicher nicht erreichbar. '), dev.storageMessage || '')));
  if (dev?.rclone && !dev.rclone.installed) out.push(h('div.banner.warn', icon('warn'), h('span', 'Am PC fehlt das Übertragungs-Programm rclone (Einstellungen → Übertragung).')));
  if (st && Date.now() - Date.parse(st.generated) > 3 * 3600000) out.push(h('div.banner', icon('info'), h('span', `Der PC hat sich zuletzt ${fmtAgo(st.generated)} gemeldet. Aufträge erledigt er, sobald Orbit NAS dort wieder läuft.`)));
  if (isDemo()) out.push(h('div.banner', icon('info'), h('span', 'Beispieldaten – Aufträge werden nur zum Schein ausgeführt.')));
  return out;
}

function operations(st) {
  const ops = st?.operations || (st?.running ? [{ id: 'run', title: st.running.text, status: 'Läuft', tone: 'Accent', percent: (st.running.progress || 0) * 100 }] : []);
  const jobs = openJobs().filter((j) => j.type !== 'liste');
  if (!ops.length && !jobs.length) return null;
  return h('section.ops', h('h2', 'Vorgänge'),
    ...ops.map((o) => h('div.card.op',
      h('div.op-top', h('b', o.title), h('span.pill.' + (TONE[o.tone] || 'accent'), o.status), o.fromPhone ? h('span.muted.small', 'vom Handy') : null),
      o.step ? h('div.muted', o.step) : null,
      o.percent != null && o.status !== 'Fertig' ? h('div.meter', h('div.fill', { style: { width: Math.round(o.percent) + '%' } })) : null,
      h('div.op-meta.muted.small', [o.percent != null && o.status !== 'Fertig' ? Math.round(o.percent) + ' %' : '', o.bytesText, o.speedText, o.etaText].filter(Boolean).join(' · ')),
      o.currentFile ? h('div.muted.small.ellipsis', o.currentFile) : null,
      o.message ? h('div.small', o.message) : null)),
    ...jobs.map((j) => h('div.card.op',
      h('div.op-top', h('b', j.label), h('span.pill.' + (j.state === 'laeuft' ? 'accent' : 'muted'), j.state === 'laeuft' ? 'Läuft' : 'Wartet auf den PC')),
      h('div.muted.small', j.message || ''))),
    jobs.length ? h('p.muted.small', 'Aufträge vom Handy erledigt der PC, sobald Orbit NAS dort läuft (spätestens nach 2 Minuten).') : null);
}

function connCard(c) {
  return h('div.card.conn',
    h('div.card-top', h('span.ibox', icon(c.type === 'LocalFolder' ? 'disk' : 'cloud')),
      h('div.card-title', h('div', h('b', c.name), c.primary ? h('span.pill.accent', 'Haupt-Cloud') : null), h('div.muted', c.typeText))),
    c.detail ? h('div.muted.small.ellipsis', c.detail) : null,
    c.spaceText ? h('div.small', c.spaceText) : null,
    h('div.status-line', h('span.dot.' + (TONE[c.tone] || 'muted')), h('b', c.status || '')),
    h('div.card-actions',
      h('button.btn.small', { onclick: () => testConn(c) }, 'Testen'),
      h('button.btn.small', { onclick: () => editConnInfo(c) }, 'Bearbeiten'),
      h('button.icon-btn', { 'aria-label': 'Mehr', onclick: () => actionSheet(c.name, [
        c.canBePrimary && !c.primary && { label: 'Als Haupt-Cloud verwenden', icon: 'star', onclick: () => setPrimary(c) },
        { label: 'Im Datei-Manager öffnen', icon: 'folder', onclick: () => go(filesHash(c.id)) },
        { label: 'Verbindung entfernen …', icon: 'trash', hint: 'Nur am PC (Zugangsdaten liegen dort)', disabled: true },
      ]) }, icon('more'))));
}

async function testConn(c) {
  const id = await sendJob('verbindungTesten', { connId: c.id }, `Verbindung „${c.name}“ testen`);
  toast('Test läuft am PC …');
  const j = await awaitJob(id, 5 * 60000);
  if (j?.state === 'fertig' || j?.state === 'fehler') toast(`${c.name}: ${j.message || (j.state === 'fertig' ? 'Verbindung in Ordnung' : 'Fehler')}`, j.state === 'fehler' ? 'err' : '');
}

async function setPrimary(c) {
  await viaPc('hauptCloud', { connId: c.id }, `„${c.name}“ als Haupt-Cloud`);
  await patchStatus((st) => { for (const x of st.connections || []) x.primary = x.id === c.id; for (const l of st.locations || []) l.primary = l.id === c.id; });
}

function editConnInfo(c) {
  sheet(h('div.dialog-body', h('p', `Die Zugangsdaten von „${c.name}“ liegen sicher verschlüsselt nur am PC. Bearbeiten bitte am PC: Sicherung → Verbindungen → „Bearbeiten“.`),
    h('p.muted.small', 'Testen und „Als Haupt-Cloud verwenden“ gehen auch vom Handy aus.')), { title: 'Verbindung bearbeiten' });
}
export function addConnectionInfo() {
  sheet(h('div.dialog-body', h('p', 'Neue Clouds, Festplatten und Orte richtest du am PC ein (Sicherung → Verbindungen → +, oder im Datei-Manager „Ort hinzufügen“). Dafür braucht es die Anmeldung bei der Cloud, und die bleibt aus Sicherheitsgründen am PC.'),
    h('p.muted.small', 'Danach erscheint der neue Ort hier automatisch.')), { title: 'Ort hinzufügen' });
}

function folderCard(f) {
  const m = MODE[f.mode] || MODE.Mirrored;
  const ok = !f.lastError && (f.mode === 'DiskOnly' || f.lastSuccess || f.mode === 'CloudOnly');
  const last = f.lastText || (f.mode === 'DiskOnly' ? 'Keine Cloud-Sicherung' : f.lastSuccess ? 'Gesichert: ' + fmtAgo(f.lastSuccess) : 'Noch nicht gesichert');
  return h('div.card.folder',
    h('div.card-top', h('span.ibox', icon(m.icon)),
      h('div.card-title', h('div', h('b', f.name), h('span.pill.accent', m.text)), h('div.muted.small', '…\\' + f.path.replace(/\//g, '\\').split('\\').slice(-2).join('\\'))),
      h('div.card-icons',
        h('button.icon-btn', { title: 'Sicherung einstellen …', onclick: () => folderDialog({ folder: f }) }, icon('edit')),
        h('button.icon-btn', { title: 'Im Datei-Manager zeigen', onclick: () => go(filesHash('storage', f.path.replace(/\\/g, '/'))) }, icon('folder')),
        h('button.icon-btn', { title: 'Aus Orbit NAS entfernen', onclick: () => removeFolder(f) }, icon('trash')))),
    h('div.status-line', h('span.dot.' + (TONE[f.tone] || (f.lastError ? 'danger' : ok ? 'ok' : 'warn'))), h('span', last),
      ...(f.targets || []).map((t) => h('span.target.muted', icon(locKindIcon(t)), ' ', locName(t)))),
    f.lastError ? h('div.err-text.small', f.lastError) : null,
    h('div.card-actions',
      f.mode === 'Mirrored' ? h('button.btn.small', { onclick: () => backupNow([f]) }, icon('shield'), ' Jetzt sichern') : null,
      f.mode !== 'CloudOnly' && (f.canOffload ?? (f.targets || []).length > 0) ? h('button.btn.small', { onclick: () => offload(f) }, icon('cloud'), ' Auslagern') : null,
      f.mode === 'CloudOnly' ? h('button.btn.small', { onclick: () => restore(f) }, icon('download'), ' Zurückholen') : null));
}

function locKindIcon(id) {
  const l = (state.status?.locations || []).find((x) => x.id === id);
  return l?.kind === 'disk' ? 'disk' : 'cloud';
}

async function removeFolder(f) {
  await viaPc('ordnerEntfernen', { folderId: f.id }, `„${f.name}“ aus Orbit NAS entfernen`, {
    ask: `„${f.name}“ aus Orbit NAS entfernen? Es werden keine Dateien gelöscht – der Ordner wird nur nicht mehr gesichert.`,
  });
}

export { MODE };
