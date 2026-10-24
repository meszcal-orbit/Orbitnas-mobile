// FRITZ!NAS: Safari-Web-Apps dürfen nicht selbst ins Heimnetz (SMB). Darum wird die FRITZ!NAS einmal in der App „Dateien“
// eingebunden. Diese Seite zeigt die Anleitung mit Eingabefeldern und bietet Wählen (Dateiauswahl) und Speichern (Teilen-Menü).

import { h, icon, toast, clear, fmtSize, actionSheet } from './util.js';
import { kv } from './db.js';
import { go } from './ui.js';
import { connections } from './sources/registry.js';

export async function fritzConfigured() { return !!(await kv.get('fritz'))?.done; }
export function openFritz() { go('#/fritz'); }

const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast('Kopiert: ' + text); } catch { toast(text); } };

export async function renderFritz(view) {
  const { pageHead } = await import('./files.js');
  const cfg = { host: 'fritz.box', user: '', done: false, ...((await kv.get('fritz')) || {}) };
  const save = () => kv.set('fritz', cfg);
  const page = h('div.page.ios');
  clear(view).append(page);
  page.append(...pageHead({ title: 'FRITZ!NAS', back: { label: 'Orte', onclick: () => go('#/orte') } }));

  // Aktionen (oben, sobald eingerichtet)
  const actions = h('section.group', h('div.group-body',
    h('button.row', { onclick: pickFromFritz }, h('span.srcicon', { style: { background: '#E2001A' } }, icon('download')),
      h('span.row-main', h('span.row-title', 'Dateien von der FRITZ!NAS wählen'), h('small.row-sub', 'Ansehen oder in eine Cloud hochladen')), icon('chevron', 'chev')),
    h('button.row', { onclick: saveToFritz }, h('span.srcicon', { style: { background: '#E2001A' } }, icon('upload')),
      h('span.row-main', h('span.row-title', 'Auf der FRITZ!NAS speichern'), h('small.row-sub', 'Eine Datei aus einer Cloud dort ablegen')), icon('chevron', 'chev'))));

  const addr = h('code');
  const host = h('input.input', { value: cfg.host, placeholder: 'fritz.box', autocapitalize: 'off', autocorrect: 'off', spellcheck: false });
  const user = h('input.input', { value: cfg.user, placeholder: 'z. B. dennis', autocapitalize: 'off', autocorrect: 'off', spellcheck: false });
  const userOut = h('b');
  const upd = () => {
    cfg.host = host.value.trim().replace(/^smb:\/\//i, '').replace(/\/+$/, '') || 'fritz.box';
    cfg.user = user.value.trim();
    addr.textContent = 'smb://' + cfg.host;
    userOut.textContent = cfg.user || '(dein FRITZ!Box-Benutzer)';
    save();
  };
  host.addEventListener('input', upd);
  user.addEventListener('input', upd);
  upd();

  const step = (n, ...c) => h('li.step', h('span.stepnum', String(n)), h('div.stepbody', ...c));
  const guide = h('section.group', h('h2.group-title', cfg.done ? 'Anleitung (zum Nachlesen)' : 'Einmal einrichten'), h('div.group-body.pad.guide',
    h('p.muted.small', 'Web-Apps dürfen aus Sicherheitsgründen nicht selbst ins Heimnetz. Darum bindest du die FRITZ!NAS einmal in der App „Dateien“ von Apple ein. Das klappt im WLAN zu Hause (unterwegs nur mit dem VPN der FRITZ!Box).'),
    h('ol.steps',
      step(1, h('b', 'Adresse und Benutzer eintragen'), h('div.label', 'Adresse der FRITZ!Box'), host, h('div.label', 'FRITZ!Box-Benutzer'), user,
        h('p.muted.small', 'Den Benutzer findest du in der FRITZ!Box unter System → FRITZ!Box-Benutzer. Er braucht das Recht „Zugang zu NAS-Inhalten“.')),
      step(2, h('b', 'Server-Adresse kopieren'), h('div.copybox', addr, h('button.btn.small', { onclick: () => copy(addr.textContent) }, icon('copy'), ' Kopieren'))),
      step(3, h('b', 'App „Dateien“ öffnen'), h('p.muted.small', 'Unten „Durchsuchen“ antippen, dann oben rechts auf ⋯ (drei Punkte) → „Mit Server verbinden“.')),
      step(4, h('b', 'Adresse einfügen → „Verbinden“')),
      step(5, h('b', '„Registrierter Benutzer“ wählen'), h('p.muted.small', 'Name: ', userOut, ' – Passwort: das Passwort dieses FRITZ!Box-Benutzers. → „Weiter“.')),
      step(6, h('b', 'Fertig'), h('p.muted.small', 'In „Dateien“ steht jetzt unter „Geteilt“ der Eintrag „', h('span', cfg.host), '“. Das Passwort merkt sich iOS, nicht diese App.'))),
    h('label.check.big', h('input', { type: 'checkbox', checked: cfg.done, onchange: async (e) => { cfg.done = e.target.checked; await save(); renderFritz(view); } }),
      h('span', h('b', 'Ist eingerichtet'), h('small', 'Dann stehen die Aktionen oben.')))));

  if (cfg.done) page.append(actions, guide);
  else page.append(guide, actions);
}

/** iOS-Dateiauswahl öffnen (dort „fritz.box“ wählen) und die gewählten Dateien anbieten. */
function pickFromFritz() {
  const inp = h('input', { type: 'file', multiple: true, hidden: true });
  inp.onchange = () => { const files = [...inp.files]; inp.remove(); if (files.length) chosen(files); };
  document.body.append(inp);
  toast('In der Auswahl links oben „Durchsuchen“ → unter „Geteilt“ „fritz.box“ wählen.');
  inp.click();
}

async function chosen(files) {
  const { openPlayer } = await import('./player.js');
  const { startUpload } = await import('./files.js');
  const { pickFolder } = await import('./picker.js');
  const items = files.map((f) => ({ name: f.name, size: f.size, mtime: f.lastModified, isFolder: false, path: '/' + f.name, file: f, localUrl: URL.createObjectURL(f), local: 'FRITZ!NAS' }));
  const total = files.reduce((s, f) => s + f.size, 0);
  actionSheet(`${files.length === 1 ? files[0].name : files.length + ' Dateien'} (${fmtSize(total)})`, [
    { label: 'Ansehen', icon: 'eye', onclick: () => openPlayer(items[0], items) },
    connections().length && { label: 'In eine Cloud hochladen …', icon: 'upload', onclick: async () => {
      const t = await pickFolder('Hochladen nach', { ok: 'Hochladen' });
      if (t) startUpload(files, t.conn, t.path);
    } },
  ]);
}

/** Datei aus einer Cloud wählen und über das Teilen-Menü („In Dateien sichern“ → fritz.box) speichern. */
async function saveToFritz() {
  if (!connections().length) { toast('Zuerst eine Cloud hinzufügen.', 'err'); return; }
  const { pickFile } = await import('./picker.js');
  const { download } = await import('./fileops.js');
  const it = await pickFile('Datei für die FRITZ!NAS');
  if (!it) return;
  toast('Im Teilen-Menü „In Dateien sichern“ → „fritz.box“ wählen.');
  await download(it);
}
