// Seite „Einstellungen“ mit denselben Abschnitten wie am PC. Einstellungen des PCs ändert die App per Auftrag;
// was nur dieses Handy betrifft (Kopplung, Face ID, Sperre, Daten), steht unter „Handy (iPhone und iPad)“.

import { h, icon, fmtSize, fmtDate, fmtAgo, toast, confirmDialog, shareOrDownload, clear } from './util.js';
import { state, sync, unpair, isDemo, clearFinishedJobs, deviceName, updateHandy, patchStatus } from './sync.js';
import { kv, cache, usage, persist } from './db.js';
import { settings, saveSettings, applyTheme, isStandalone, go } from './ui.js';
import { THEMES, ACCENTS } from './theme.js';
import { lock, saveLock, activePin, faceIdAvailable, enrollFaceId, disableFaceId, setOwnPin, checkFaceId } from './lock.js';
import { openPairing, openLogin } from './pairing.js';
import { loadLogin } from './login.js';
import { viaPc, locName, setIgnored } from './locations.js';
import { APP_VERSION } from './version.js';

const card = (title, sub, ...children) => h('section.card.scard', h('h2', title), sub ? h('p.sub', sub) : null, ...children);
const kvRow = (k, v) => h('div.kvrow', h('span.k', k), h('span.v', v));
const check = (label, desc, checked, onchange, disabled = false) => h('label.check.big' + (disabled ? '.dim' : ''),
  h('input', { type: 'checkbox', checked, disabled, onchange: (e) => onchange(e.target.checked, e.target) }), h('span', h('b', label), desc ? h('small', desc) : null));

export async function renderSettings(view) {
  const st = state.status;
  const dev = st?.device;
  const page = h('div.page.settings');
  clear(view).append(page);
  page.append(h('div.page-head', h('h1', 'Einstellungen')));

  // Speicherort
  page.append(card('Speicherort', 'Hier liegen deine Daten und die gemeinsame Einrichtung (für PC und Laptop gleich).',
    dev ? kvRow('Ordner am PC', dev.storagePath || '–') : h('p.muted', 'Noch keine Daten vom PC.'),
    dev ? h('p.' + (dev.storageOk === false ? 'err-text' : 'ok-text'), dev.storageMessage || (dev.storageOk ? 'Speicher erreichbar und beschreibbar.' : '')) : null,
    h('p.muted.small', 'Ändern bitte am PC (Einstellungen → Speicherort), denn dort wird der Ordner ausgewählt und geprüft.')));

  // Der PC und seine Betriebsart
  if (dev) {
    const time = h('input.input.time', { type: 'time', value: dev.dailyBackupTime || '02:00' });
    const set = (args, label) => viaPc('einstellungen', args, label).then(() => patchStatus((s) => Object.assign(s.device, args)));
    const runModes = [
      ['OnDemand', 'Nur bei Bedarf öffnen', 'Läuft nur, solange das Fenster offen ist. Verpasste Sicherungen werden beim Öffnen angeboten.'],
      ['Background', 'Im Hintergrund (empfohlen für das Sicherungs-Gerät)', 'Startet mit Windows, Symbol neben der Uhr, fragt zur Sicherungszeit um Erlaubnis.'],
      ['Scheduled', 'Geplant über die Windows-Aufgabenplanung', 'Windows startet Orbit NAS zur Sicherungszeit; danach beendet es sich wieder.'],
    ];
    page.append(card(`PC „${dev.name || st.pc}“ und Betriebsart`, 'Diese Einstellungen gelten am PC. Änderungen schickt die App als Auftrag; der PC übernimmt sie, sobald Orbit NAS dort läuft.',
      h('div.form-grid',
        h('div', h('div.label', 'Gerätename'), h('div.input.static', dev.name || st.pc)),
        h('div', h('div.label', 'Tägliche Sicherung um'), h('div.row-input', time, h('button.btn', { onclick: () => set({ dailyBackupTime: time.value }, `Tägliche Sicherung um ${time.value}`) }, 'Speichern')))),
      check('Dieses Gerät sichert automatisch', 'Nur EIN Gerät sollte das tun (z. B. der PC). Eine Sperrdatei verhindert ohnehin, dass zwei Geräte gleichzeitig synchronisieren.', !!dev.backsUp,
        (on) => set({ backsUp: on }, on ? 'PC sichert automatisch' : 'PC sichert nicht mehr automatisch')),
      h('div.label', 'Betriebsart'),
      h('div.radios', runModes.map(([v, t, d]) => h('label.radio' + (dev.runMode === v ? '.on' : ''),
        h('input', { type: 'radio', name: 'runmode', checked: dev.runMode === v, onchange: () => set({ runMode: v }, 'Betriebsart: ' + t).then(() => renderSettings(view)) }), h('span', h('b', t), h('small', d))))),
      check('Geplante Sicherungen ohne Rückfrage starten (Erlaubnis im Voraus)', 'Gilt nur für das normale Spiegeln. Auslagern und Zurückholen fragen immer.', !!dev.preapprove,
        (on) => set({ preapprove: on }, on ? 'Sicherungen ohne Rückfrage' : 'Sicherungen mit Rückfrage')),
      check('Vor dem Auslagern gründlich prüfen (empfohlen)', 'Orbit NAS lädt vor dem Löschen auf dem Speicher alles einmal herunter und vergleicht es Byte für Byte. Dauert länger, ist aber am sichersten.', dev.thoroughCheck !== false,
        (on) => set({ thoroughCheck: on }, on ? 'Gründlich prüfen an' : 'Gründlich prüfen aus'))));
  }

  // Aussehen
  page.append(appearance(view));

  // Übertragung (rclone)
  if (dev?.rclone) {
    page.append(card('Übertragung (rclone)', 'rclone überträgt am PC die Dateien. Es wird von downloads.rclone.org geladen und per SHA-256-Prüfsumme auf Echtheit geprüft.',
      kvRow('Installiert', dev.rclone.installed ? 'v' + dev.rclone.installed.replace(/^v/, '') : 'nicht installiert'),
      kvRow('Neueste', dev.rclone.latest ? 'v' + dev.rclone.latest.replace(/^v/, '') : 'unbekannt'),
      h('p.muted.small', 'Installieren und Aktualisieren bitte am PC.')));
  }

  // Sicherheit
  page.append(await security(view));

  // Ignorierte Ordner (nur hier wieder aufheben)
  page.append(ignoredCard(view));

  // Handy (iPhone und iPad)
  page.append(await phone(view));

  // Über Orbit NAS
  page.append(card('Über Orbit NAS', `Orbit NAS Mobil ${APP_VERSION}` + (st?.appVersion ? ` · am PC: Orbit NAS ${st.appVersion}` : ''),
    kvRow('Als App installiert', isStandalone() ? 'ja' : 'nein (läuft in Safari)'),
    h('div.btn-row.left',
      h('button.btn', { onclick: checkUpdate }, icon('sync'), ' Nach Update suchen'),
      h('a.btn', { href: 'vendor/LIZENZEN.txt', target: '_blank' }, 'Lizenzen')),
    h('p.muted.small', 'Updates kommen automatisch beim Öffnen der App. Deine Daten bleiben dabei unverändert. Keine Werbung, keine Analyse, keine fremden Server außer pCloud.')));
}

function appearance(view) {
  const fromPc = settings.designFromPc && state.status?.design;
  const curTheme = fromPc ? state.status.design.theme : settings.theme;
  const curAccent = fromPc ? state.status.design.accent : settings.accent;
  const pick = (theme, accent) => { settings.designFromPc = false; settings.theme = theme; settings.accent = accent; saveSettings(); applyTheme(state.status); renderSettings(view); };
  const custom = h('input.color', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(curAccent || '') ? curAccent : THEMES[curTheme]?.accent || '#6366F1' });
  return card('Aussehen', 'Wähle ein Design. Änderungen wirken sofort.',
    check('Wie am PC', state.status?.design ? `Design und Akzentfarbe vom PC übernehmen (gerade: ${state.status.design.theme}).` : 'Sobald der PC sein Design meldet (ab 0.5.2).', !!settings.designFromPc,
      (on) => { settings.designFromPc = on; saveSettings(); applyTheme(state.status); renderSettings(view); }),
    h('div.themes', Object.entries(THEMES).map(([name, t]) => h('button.theme' + (name === curTheme ? '.on' : ''), { onclick: () => pick(name, null) },
      h('span.tprev', { style: { background: t.grad ? `linear-gradient(135deg, ${t.bg}, ${t.grad})` : t.bg, borderColor: t.border } },
        h('span', { style: { background: t.side } }), h('span', { style: { background: t.surface, borderColor: t.border } }), h('i', { style: { background: t.accent } })),
      h('span', name)))),
    h('div.label', 'Akzentfarbe'),
    h('div.swatches', ACCENTS.map((c) => h('button.swatch' + ((curAccent || '').toLowerCase() === c.toLowerCase() ? '.on' : ''), { style: { background: c }, 'aria-label': c, onclick: () => pick(curTheme, c) }))),
    h('div.row-input', h('span.label', 'Eigene Farbe:'), custom, h('button.btn', { onclick: () => pick(curTheme, custom.value) }, 'Übernehmen'),
      h('button.btn', { onclick: () => pick(curTheme, null) }, 'Farbe des Designs')));
}

async function security(view) {
  const pin = activePin();
  const faceOk = await faceIdAvailable();
  const pcPin = state.status?.pin;
  const sel = h('select.input', { onchange: async (e) => { lock.autoLockMin = Number(e.target.value); await saveLock(); toast('Gespeichert'); } },
    [[0, 'sofort'], [1, 'nach 1 Minute'], [2, 'nach 2 Minuten'], [5, 'nach 5 Minuten'], [15, 'nach 15 Minuten']].map(([v, l]) => h('option', { value: v, selected: lock.autoLockMin === v }, l)));
  return card('Sicherheit', 'Programm-PIN oder -Passwort: Schützt Orbit NAS vor fremden Blicken (wird beim Öffnen abgefragt). Ordner und ganze Orte schützt du im Datei-Manager mit „Mit PIN schützen …“.',
    h('div.status-line', h('span.dot.' + (pin ? 'ok' : 'muted')), h('span', pcPin ? `Programm-PIN vom PC (${state.status.pinIsPin !== false ? (state.status.pinLength || 4) + ' Ziffern' : 'Passwort'})` : lock.ownPin ? 'Eigene PIN für dieses Handy' : 'Kein Programm-Passwort')),
    pcPin ? h('p.muted.small', 'Die PIN wird am PC geändert (Einstellungen → Sicherheit) und kommt automatisch hierher.')
      : h('div.btn-row.left',
        h('button.btn', { onclick: async () => { if (await setOwnPin()) { toast('PIN gespeichert'); renderSettings(view); } } }, lock.ownPin ? 'PIN ändern' : 'PIN festlegen'),
        lock.ownPin ? h('button.btn.danger', { onclick: async () => { if (await confirmDialog('PIN für dieses Handy entfernen?', { ok: 'Entfernen', danger: true })) { lock.ownPin = null; lock.faceId = null; await saveLock(); renderSettings(view); } } }, 'PIN entfernen') : null),
    faceOk ? check('Mit Face ID entsperren', 'iOS speichert dafür einen Passkey „Orbit NAS“ im Schlüsselbund. Die PIN bleibt als Ersatz.', !!lock.faceId, async (on, el) => {
      if (on && !pin) { el.checked = false; toast('Bitte zuerst eine PIN festlegen (als Ersatz, falls Face ID nicht klappt).', 'err'); return; }
      try {
        if (on) { await enrollFaceId(); if (!(await checkFaceId())) throw new Error('Face ID wurde nicht bestätigt.'); toast('Face ID ist eingerichtet'); }
        else { await disableFaceId(); toast('Face ID ausgeschaltet'); }
      } catch (e) { el.checked = false; await disableFaceId(); if (e.name !== 'NotAllowedError') toast(e.message, 'err'); }
    }) : h('p.muted.small', 'Face ID / Touch ID ist auf diesem Gerät nicht verfügbar.'),
    h('div.row-input', h('span.label', 'Automatisch sperren, wenn die App im Hintergrund war:'), sel));
}

function ignoredCard(view) {
  const ig = state.status?.ignored || {};
  const list = Object.entries(ig).flatMap(([loc, paths]) => (paths || []).map((p) => ({ location: loc, rel: p.replace(/\\/g, '/'), name: p.split(/[\\/]/).pop() })));
  return card('Ignorierte Ordner', 'Diese Ordner sind dauerhaft ausgeblendet – auch wenn „Versteckte zeigen“ an ist. Nur hier machst du sie wieder sichtbar.',
    list.length ? h('div.iglist', list.map((it) => h('div.igrow', icon('ignore'), h('span', h('b', it.name), h('small', locName(it.location) + ' › ' + it.rel.replace(/\//g, ' › '))),
      h('button.btn.small', { onclick: async () => { await setIgnored(it, false); toast('Wird wieder angezeigt'); renderSettings(view); } }, 'Wieder anzeigen'))))
      : h('p.muted', 'Keine. Im Datei-Manager: Menü eines Ordners → „Dauerhaft ignorieren …“.'));
}

async function phone(view) {
  const p = state.pairing;
  const box = card('Handy (iPhone und iPad)', 'Dieses Gerät ist mit Orbit NAS am PC gekoppelt. Alles, was zwischen PC und Handy ausgetauscht wird, ist Ende-zu-Ende verschlüsselt.');
  const acc = h('span', '…');
  const login = isDemo() ? null : await loadLogin();
  box.append(
    kvRow('Gekoppelt mit', p.pc + (isDemo() ? ' (Beispiel)' : '')),
    kvRow('Seit', fmtDate(p.paired)),
    kvRow('Dieses Gerät', deviceName()),
    kvRow('pCloud-Konto', acc),
    isDemo() ? null : kvRow('pCloud-Anmeldung', login ? h('span', login.user, ' ', h('button.link', { onclick: async () => { if (await openLogin({ reason: 'Neue Anmeldung bei pCloud, zum Beispiel nach einer Passwortänderung.' })) renderSettings(view); } }, 'Ändern'))
      : h('button.btn.small.primary', { onclick: async () => { if (await openLogin()) { sync({ force: true }).catch(() => {}); renderSettings(view); } } }, 'Jetzt anmelden')),
    kvRow('Letzter Abgleich', state.lastSync ? fmtAgo(state.lastSync) : 'noch nie'),
    kvRow('Daten vom PC', state.status ? fmtAgo(state.status.generated) : 'noch keine'),
    state.syncError ? h('p.err-text', state.syncError.message) : null,
    h('div.btn-row.left',
      h('button.btn.primary', { onclick: async () => { try { await sync({ force: true }); toast('Abgeglichen'); renderSettings(view); } catch (e) { toast(e.message, 'err'); } } }, icon('sync'), ' Jetzt abgleichen'),
      h('button.btn', { onclick: openPairing }, icon('camera'), isDemo() ? ' Mit PC koppeln' : ' Neu koppeln'),
      h('button.btn.danger', { onclick: async () => {
        if (!(await confirmDialog('Dieses Gerät entkoppeln? In pCloud und am PC wird nichts gelöscht. Danach kannst du jederzeit neu koppeln.', { ok: 'Entkoppeln', danger: true }))) return;
        await unpair();
      } }, 'Entkoppeln')),
    h('p.muted.small', 'Abgleich beim Öffnen der App und danach jede Minute (alle 10 Sekunden, solange ein Auftrag läuft). Der PC erledigt Aufträge, solange Orbit NAS dort läuft (Abgleich alle 2 Minuten). Ein verlorenes Handy sperrst du am PC aus: Einstellungen → Handy → „Neu koppeln (alte Handys aussperren)“.'));
  state.backend.userinfo().then((u) => { acc.textContent = u.email; }).catch(() => { acc.textContent = '–'; });

  // Aufträge
  const jobs = state.jobs.slice(0, 20);
  box.append(h('h3', 'Aufträge an den PC'),
    jobs.length ? h('div.joblist', jobs.map((j) => h('div.jobrow', h('span.dot.' + ({ fertig: 'ok', fehler: 'danger', laeuft: 'accent' }[j.state] || 'muted')),
      h('span', h('b', j.label), h('small', `${fmtAgo(j.created)} · ${{ gesendet: 'wartet auf den PC', laeuft: 'läuft', fertig: 'erledigt', fehler: 'Fehler' }[j.state] || j.state}${j.message ? ' · ' + j.message : ''}`))))) : h('p.muted', 'Noch keine.'),
    jobs.length ? h('button.link', { onclick: async () => { await clearFinishedJobs(); renderSettings(view); } }, 'Erledigte aus der Liste entfernen') : null);

  // Daten auf diesem Gerät
  const u = await usage();
  const persisted = await persist();
  box.append(h('h3', 'Daten auf diesem Gerät'),
    kvRow('Belegt', u ? fmtSize(u.usage) : '–'),
    kvRow('Dauerhaft gespeichert', persisted ? 'ja' : 'nein (iOS entscheidet)'),
    h('p.muted.small', 'Deine Dateien liegen in pCloud, am PC und auf der FRITZ!NAS – nicht nur hier. App-Updates ändern nichts an deinen Daten. Hier liegen nur Einstellungen, die Kopplung und zwischengespeicherte Listen.'),
    h('div.btn-row.left',
      h('button.btn', { onclick: backupData }, icon('download'), ' Handy-Daten sichern'),
      h('button.btn', { onclick: restoreData }, 'Wiederherstellen'),
      h('button.btn', { onclick: async () => { await cache.clear(); if ('caches' in window) await caches.delete('orbitnas-thumbs'); toast('Zwischenspeicher geleert'); renderSettings(view); } }, 'Zwischenspeicher leeren')));
  return box;
}

async function checkUpdate() {
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg) { location.reload(); return; }
  await reg.update();
  if (reg.waiting || reg.installing) toast('Neue Version wird geladen …'); else toast('Du hast die neueste Version.');
}

async function backupData() {
  const data = {
    app: 'Orbit NAS Mobil', version: APP_VERSION, created: new Date().toISOString(), device: deviceName(),
    settings: { ...settings }, lock: { autoLockMin: lock.autoLockMin }, handy: state.handy, jobs: state.jobs,
  };
  await shareOrDownload(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `OrbitNAS-Handy-Sicherung-${new Date().toISOString().slice(0, 10)}.json`);
}

function restoreData() {
  const inp = h('input', { type: 'file', accept: 'application/json,.json' });
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.app !== 'Orbit NAS Mobil') throw new Error('Das ist keine Sicherung von Orbit NAS Mobil.');
      if (!(await confirmDialog(`Sicherung vom ${fmtDate(d.created)} (${d.device}) übernehmen? Vorhandenes wird zusammengeführt, nichts gelöscht.`, { ok: 'Übernehmen' }))) return;
      const { theme, accent, designFromPc, tileView, sort, showHidden } = d.settings || {};
      Object.assign(settings, Object.fromEntries(Object.entries({ theme, accent, designFromPc, tileView, sort, showHidden }).filter(([, v]) => v !== undefined)));
      await saveSettings();
      applyTheme(state.status);
      await updateHandy((hd) => { Object.assign(hd.uploads ||= {}, d.handy?.uploads || {}); Object.assign(hd.favs ||= {}, d.handy?.favs || {}); });
      toast('Wiederhergestellt');
      go('#/einstellungen');
    } catch (e) { toast(e.message, 'err'); }
  };
  inp.click();
}


