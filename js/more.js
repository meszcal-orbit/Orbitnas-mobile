// Willkommen, Koppeln mit dem PC und alle Einstellungen („Mehr“).

import { h, icon, fmtSize, fmtDate, fmtAgo, toast, sheet, confirmDialog, shareOrDownload, loadScript, clear } from './util.js';
import { state, pair, parsePairing, startDemo, unpair, sync, isDemo, clearFinishedJobs, deviceName, updateHandy } from './sync.js';
import { kv, cache, usage, persist } from './db.js';
import { settings, saveSettings, applyTheme, go, isStandalone } from './ui.js';
import { lock, saveLock, activePin, faceIdAvailable, enrollFaceId, disableFaceId, setOwnPin, checkFaceId } from './lock.js';
import { jobRow } from './start.js';
import { APP_VERSION } from './version.js';

// ---------------------------------------------------------------- Willkommen (noch nicht gekoppelt)

export function renderWelcome(root) {
  const ios = /iPhone|iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const needsInstall = ios && !isStandalone();
  clear(root).append(h('div.welcome',
    h('img.logo', { src: 'icons/icon-192.png', alt: '' }),
    h('h1', 'Orbit NAS'),
    h('p.muted', 'Deine Dateien aus pCloud, vom PC und von der FRITZ!NAS – auf iPhone und iPad.'),
    needsInstall ? h('div.card.install',
      h('h2', 'Zuerst auf den Home-Bildschirm'),
      h('ol',
        h('li', 'Unten (iPad: oben rechts) auf das ', h('strong', 'Teilen-Symbol'), ' tippen (Quadrat mit Pfeil nach oben).'),
        h('li', 'Nach unten wischen und ', h('strong', '„Zum Home-Bildschirm“'), ' tippen.'),
        h('li', 'Rechts oben ', h('strong', '„Hinzufügen“'), ' tippen.'),
        h('li', 'Safari schließen und ', h('strong', 'Orbit NAS'), ' über das neue Symbol öffnen.')),
      h('p.muted.small', 'Wichtig: Koppeln bitte erst in der App vom Home-Bildschirm. Safari und die App haben getrennte Speicher.')) : null,
    h('div.btn-col',
      h('button.btn.primary.big', { onclick: openPairing }, icon('camera'), ' Mit PC koppeln'),
      h('button.btn', { onclick: async () => { await startDemo(); } }, 'Mit Beispieldaten ausprobieren')),
    h('p.muted.small', 'Am PC: Orbit NAS (ab Version 0.5.1) → Einstellungen → „Handy koppeln“. Dort erscheint ein QR-Code.')));
}

// ---------------------------------------------------------------- Koppeln: QR-Code scannen, Foto lesen oder Code einfügen

export function openPairing() {
  const video = h('video.scan', { playsinline: true, muted: true, autoplay: true });
  const status = h('p.muted.center', 'Kamera wird gestartet …');
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const textArea = h('textarea.input', { rows: 3, placeholder: 'ORBITNAS1:…', autocapitalize: 'off', autocorrect: 'off', spellcheck: false });
  let stream = null;
  let stopped = false;
  const stop = () => { stopped = true; if (stream) stream.getTracks().forEach((t) => t.stop()); };
  const body = h('div.pairing',
    h('div.scanbox', video, h('div.scanframe')), status,
    h('div.btn-col',
      h('button.btn', { onclick: () => fileInput.click() }, icon('image'), ' Foto oder Bildschirmfoto mit QR-Code wählen'),
      h('details', h('summary', 'Code von Hand einfügen'), textArea, h('button.btn.primary.block', { onclick: () => finish(textArea.value) }, 'Koppeln'))),
    fileInput);
  const s = sheet(body, { title: 'Mit PC koppeln', onClose: stop });

  async function finish(text) {
    let p;
    try { p = parsePairing(text); } catch (e) { status.textContent = e.message; status.className = 'err-text center'; return; }
    stop();
    status.className = 'muted center';
    status.textContent = 'Verbinde mit pCloud …';
    try {
      await pair(p);
      s.close();
      toast('Gekoppelt mit ' + p.pc);
      go('#/start');
    } catch (e) {
      status.className = 'err-text center';
      status.textContent = e.code === 'KEY' ? e.message : 'Koppeln hat nicht geklappt: ' + e.message;
    }
  }

  fileInput.onchange = async () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    status.textContent = 'Lese Bild …';
    try {
      await loadScript('vendor/jsQR.js');
      const bmp = await createImageBitmap(f);
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      const code = window.jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
      if (code) finish(code.data); else status.textContent = 'Auf dem Bild wurde kein QR-Code gefunden.';
    } catch (e) { status.textContent = e.message; }
  };

  (async () => {
    try {
      await loadScript('vendor/jsQR.js');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (stopped) { stop(); return; }
      video.srcObject = stream;
      await video.play();
      status.textContent = 'Halte die Kamera auf den QR-Code am PC.';
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d', { willReadFrequently: true });
      const tick = () => {
        if (stopped) return;
        if (video.videoWidth) {
          const w = 640, hgt = Math.round((video.videoHeight / video.videoWidth) * 640);
          c.width = w; c.height = hgt;
          ctx.drawImage(video, 0, 0, w, hgt);
          const code = window.jsQR(ctx.getImageData(0, 0, w, hgt).data, w, hgt, { inversionAttempts: 'dontInvert' });
          if (code && code.data.startsWith('ORBITNAS1:')) { navigator.vibrate && navigator.vibrate(30); finish(code.data); return; }
        }
        setTimeout(tick, 180);
      };
      tick();
    } catch (e) {
      status.textContent = e.name === 'NotAllowedError'
        ? 'Kein Zugriff auf die Kamera. Erlauben unter Einstellungen → Orbit NAS bzw. Safari → Kamera, oder unten ein Foto des QR-Codes wählen.'
        : 'Kamera nicht verfügbar. Bitte ein Foto des QR-Codes wählen.';
    }
  })();
}

// ---------------------------------------------------------------- Mehr

const SECTIONS = [
  ['kopplung', 'Kopplung & Abgleich', 'link'],
  ['sicherheit', 'Sperre & Face ID', 'lock'],
  ['auftraege', 'Aufträge an den PC', 'task'],
  ['aussehen', 'Aussehen', 'eye'],
  ['daten', 'Daten & Sicherung', 'download'],
  ['hilfe', 'Hilfe', 'info'],
  ['info', 'Über & Updates', 'sync'],
];

export async function renderMore(view, parts) {
  const sec = parts[1];
  clear(view);
  if (!sec) {
    view.append(h('div.page-head', h('h1', 'Mehr')),
      h('div.list.menu', SECTIONS.map(([id, label, ic]) => h('button.item.row', { onclick: () => go('#/mehr/' + id) }, h('span.ficon', icon(ic)), h('div.iname', h('div.n', label)), icon('back', 'flip')))));
    return;
  }
  const label = SECTIONS.find((x) => x[0] === sec)?.[1] || 'Mehr';
  view.append(h('div.page-head', h('button.icon-btn', { 'aria-label': 'Zurück', onclick: () => go('#/mehr') }, icon('back')), h('h1', label)));
  const box = h('div.settings');
  view.append(box);
  const fn = { kopplung, sicherheit, auftraege, aussehen, daten, hilfe, info }[sec];
  if (fn) await fn(box, () => renderMore(view, parts));
}

const row = (label, value, extra) => h('div.srow', h('span.l', label), h('span.v', value), extra || null);
const group = (title, ...children) => h('section.sgroup', title ? h('h2', title) : null, ...children);

function toggle(checked, onchange) {
  const inp = h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked, e.target) });
  return h('label.switch', inp, h('span'));
}

async function kopplung(box, refresh) {
  const p = state.pairing;
  let email = '…';
  box.append(group('PC',
    row('Gekoppelt mit', p.pc + (isDemo() ? ' (Beispiel)' : '')),
    row('Seit', fmtDate(p.paired)),
    row('Dieses Gerät', deviceName()),
    row('pCloud-Konto', h('span', { id: 'acc' }, email)),
    row('Letzter Abgleich', state.lastSync ? fmtAgo(state.lastSync) : 'noch nie'),
    row('Daten vom PC', state.status ? fmtAgo(state.status.generated) : 'noch keine'),
    state.syncError ? h('p.err-text', state.syncError.message) : null));
  state.backend.userinfo().then((u) => { const el = box.querySelector('#acc'); if (el) el.textContent = u.email; }).catch(() => {});
  box.append(h('div.btn-col',
    h('button.btn.primary', { onclick: async () => { try { await sync({ force: true }); toast('Abgeglichen'); refresh(); } catch (e) { toast(e.message, 'err'); } } }, icon('sync'), ' Jetzt abgleichen'),
    h('button.btn', { onclick: openPairing }, icon('camera'), isDemo() ? ' Mit PC koppeln' : ' Neu koppeln'),
    h('button.btn.danger', {
      onclick: async () => {
        if (!(await confirmDialog('Dieses Gerät entkoppeln? In pCloud und am PC wird nichts gelöscht. Danach kannst du jederzeit neu koppeln.', { ok: 'Entkoppeln', danger: true }))) return;
        await unpair();
      },
    }, 'Entkoppeln')),
  h('p.muted.small', 'Abgleich: Beim Öffnen der App und danach jede Minute. Dateien liegen in pCloud und sind auf allen Geräten gleich. Status, PC-Liste, PINs und Favoriten kommen vom PC; Upload-Liste und eigene Favoriten teilen sich alle Handys und iPads – alles Ende-zu-Ende verschlüsselt.'));
}

async function sicherheit(box, refresh) {
  const pin = activePin();
  const faceOk = await faceIdAvailable();
  box.append(group('PIN',
    row('PIN', pin ? (pin.fromPc ? 'vom PC (' + (pin.isPin ? pin.length + ' Ziffern' : 'Passwort') + ')' : 'eigene App-PIN') : 'keine'),
    !state.status?.pin ? h('div.btn-col',
      h('button.btn', { onclick: async () => { if (await setOwnPin()) { toast('App-PIN gespeichert'); refresh(); } } }, lock.ownPin ? 'App-PIN ändern' : 'App-PIN festlegen'),
      lock.ownPin ? h('button.btn.danger', { onclick: async () => { if (await confirmDialog('App-PIN entfernen?', { ok: 'Entfernen', danger: true })) { lock.ownPin = null; if (!state.status?.pin) lock.faceId = null; await saveLock(); refresh(); } } }, 'App-PIN entfernen') : null)
      : h('p.muted.small', 'Die PIN wird am PC geändert (Einstellungen → Sicherheit) und kommt automatisch hierher.')));
  box.append(group('Face ID',
    !faceOk ? h('p.muted', 'Face ID / Touch ID ist auf diesem Gerät nicht verfügbar.') :
      row('Mit Face ID entsperren', '', toggle(!!lock.faceId, async (on, el) => {
        if (on && !pin) { el.checked = false; toast('Bitte zuerst eine PIN festlegen (als Ersatz, falls Face ID nicht klappt).', 'err'); return; }
        try {
          if (on) { await enrollFaceId(); if (!(await checkFaceId())) throw new Error('Face ID wurde nicht bestätigt.'); toast('Face ID ist eingerichtet'); }
          else { await disableFaceId(); toast('Face ID ausgeschaltet'); }
        } catch (e) { el.checked = false; await disableFaceId(); if (e.name !== 'NotAllowedError') toast(e.message, 'err'); }
      })),
    h('p.muted.small', 'iOS speichert dafür einen Passkey „Orbit NAS“ in deinem Schlüsselbund. Die PIN bleibt als Ersatz.')));
  const sel = h('select.input', { onchange: async (e) => { lock.autoLockMin = Number(e.target.value); await saveLock(); toast('Gespeichert'); } },
    [[0, 'sofort'], [1, 'nach 1 Minute'], [2, 'nach 2 Minuten'], [5, 'nach 5 Minuten'], [15, 'nach 15 Minuten']].map(([v, l]) => h('option', { value: v, selected: lock.autoLockMin === v }, l)));
  box.append(group('Automatisch sperren', row('Wenn die App im Hintergrund war', '', sel)));
}

async function auftraege(box, refresh) {
  if (!state.jobs.length) box.append(h('p.muted', 'Noch keine Aufträge.'));
  box.append(h('div.list', state.jobs.map(jobRow)));
  box.append(h('div.btn-col',
    h('button.btn', { onclick: async () => { try { await sync(); refresh(); } catch (e) { toast(e.message, 'err'); } } }, icon('sync'), ' Status abfragen'),
    state.jobs.length ? h('button.btn', { onclick: async () => { await clearFinishedJobs(); refresh(); } }, 'Erledigte aus der Liste entfernen') : null),
  h('p.muted.small', 'Aufträge erledigt der PC, sobald Orbit NAS dort läuft (spätestens nach 2 Minuten).'));
}

async function aussehen(box) {
  const opts = [['auto', 'Automatisch (wie iPhone/iPad)'], ['orbit', 'Orbit (dunkel)'], ['hell', 'Hell']];
  box.append(group('Design', h('div.radio', opts.map(([v, l]) => h('label.srow', h('span.l', l),
    h('input', { type: 'radio', name: 'theme', checked: settings.theme === v, onchange: () => { settings.theme = v; saveSettings(); applyTheme(); } }))))));
  box.append(group('Dateien',
    row('Versteckte Dateien zeigen', '', toggle(settings.showHidden, (on) => { settings.showHidden = on; saveSettings(); })),
    row('Ansicht', '', h('select.input', { onchange: (e) => { settings.view = e.target.value; saveSettings(); } },
      h('option', { value: 'liste', selected: settings.view === 'liste' }, 'Liste'), h('option', { value: 'kacheln', selected: settings.view === 'kacheln' }, 'Kacheln')))));
}

async function daten(box, refresh) {
  const u = await usage();
  const persisted = await persist();
  box.append(group('Auf diesem Gerät',
    row('Belegt', u ? fmtSize(u.usage) : '–'),
    row('Dauerhaft gespeichert', persisted ? 'ja' : 'nein (iOS entscheidet)'),
    h('p.muted.small', 'Deine Dateien liegen in pCloud und am PC, nicht nur hier. App-Updates ändern nichts an deinen Daten. Hier liegen nur Einstellungen, Kopplung und zwischengespeicherte Listen.')));
  box.append(group('Handy-Daten sichern',
    h('p.muted.small', 'Speichert Einstellungen, Favoriten und die Liste der hochgeladenen Fotos in eine Datei. Im Teilen-Menü „In Dateien sichern“ wählen, z. B. auf die FRITZ!NAS.'),
    h('div.btn-col',
      h('button.btn.primary', { onclick: backupData }, icon('download'), ' Sicherung erstellen'),
      h('button.btn', { onclick: restoreData }, 'Aus Sicherung wiederherstellen'))));
  box.append(group('Zwischenspeicher',
    h('p.muted.small', 'Ordnerlisten und Vorschaubilder für offline. Leeren ist harmlos, alles wird neu geladen.'),
    h('button.btn', { onclick: async () => { await cache.clear(); if ('caches' in window) await caches.delete('orbitnas-thumbs'); toast('Zwischenspeicher geleert'); refresh(); } }, 'Zwischenspeicher leeren')));
}

async function backupData() {
  const data = {
    app: 'Orbit NAS Mobil', version: APP_VERSION, created: new Date().toISOString(), device: deviceName(),
    settings: { ...settings }, lock: { autoLockMin: lock.autoLockMin }, handy: state.handy, jobs: state.jobs,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  await shareOrDownload(blob, `OrbitNAS-Handy-Sicherung-${new Date().toISOString().slice(0, 10)}.json`);
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
      Object.assign(settings, d.settings || {});
      await saveSettings();
      applyTheme();
      await updateHandy((hd) => {
        Object.assign(hd.uploads ||= {}, d.handy?.uploads || {});
        Object.assign(hd.favs ||= {}, d.handy?.favs || {});
      });
      toast('Wiederhergestellt');
    } catch (e) { toast(e.message, 'err'); }
  };
  inp.click();
}

async function hilfe(box) {
  const faq = [
    ['Wie bekomme ich die App auf ein weiteres Gerät?', 'In Safari die Adresse der App öffnen → Teilen-Symbol → „Zum Home-Bildschirm“. Dann die App öffnen und am PC unter Einstellungen → „Handy koppeln“ den QR-Code scannen.'],
    ['Warum sehe ich Dateien vom PC, kann sie aber nicht direkt öffnen?', 'Dateien, die nur am PC oder auf der FRITZ!NAS liegen, holt der PC auf Wunsch in pCloud („Auf Handy holen“). Gesicherte Ordner öffnet die App direkt aus der Sicherung in pCloud.'],
    ['Was passiert, wenn ich beim Hochladen die App verlasse?', 'iOS pausiert das Hochladen. Sobald du die App wieder öffnest, geht es an derselben Stelle weiter.'],
    ['Werden Fotos doppelt hochgeladen?', 'Nein. Die App erkennt schon hochgeladene Fotos und Videos (auch von anderen Geräten) und überspringt sie. Mit „Trotzdem“ kannst du sie bewusst noch einmal hochladen.'],
    ['Was kann ich am Handy nicht?', 'Die Sicherungen selbst laufen am PC. Am Handy schickst du dafür Aufträge („Jetzt sichern“, „Auslagern“, „Zurückholen“). Den Sicherungsbereich in pCloud kann das Handy nur ansehen.'],
    ['Geht die App offline?', 'Ja. Zuletzt geöffnete Ordner, die PC-Liste und die Suche funktionieren ohne Internet. Öffnen und Hochladen brauchen Internet.'],
    ['Ich habe das Handy verloren.', 'Am PC unter „Handy koppeln“ → „Neu koppeln (alte Handys aussperren)“. Danach kann das alte Gerät nichts mehr lesen.'],
  ];
  box.append(...faq.map(([q, a]) => h('details.faq', h('summary', q), h('p', a))));
}

async function info(box) {
  box.append(group('Orbit NAS Mobil',
    row('Version', APP_VERSION),
    row('Als App installiert', isStandalone() ? 'ja' : 'nein (läuft in Safari)'),
    h('div.btn-col', h('button.btn', {
      onclick: async () => {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (!reg) { location.reload(); return; }
        await reg.update();
        if (reg.waiting || reg.installing) toast('Neue Version wird geladen …'); else toast('Du hast die neueste Version.');
      },
    }, icon('sync'), ' Nach Update suchen')),
    h('p.muted.small', 'Updates kommen automatisch beim Öffnen der App. Deine Daten bleiben dabei unverändert.')));
  box.append(group('Lizenzen', h('p.muted.small', 'Enthält jsQR (Apache 2.0), jsPDF und jsPDF-AutoTable (MIT). Keine Werbung, keine Analyse, keine fremden Server außer pCloud.'),
    h('a.link', { href: 'vendor/LIZENZEN.txt', target: '_blank' }, 'Lizenztexte anzeigen')));
}
