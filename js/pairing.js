// Willkommen (noch nicht gekoppelt) und Koppeln mit dem PC per QR-Code.

import { h, icon, toast, sheet, loadScript, clear } from './util.js';
import { pair, parsePairing, startDemo, setPcloudLogin } from './sync.js';
import { go, isStandalone } from './ui.js';

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
    h('p.muted.small', 'Am PC: Orbit NAS → Einstellungen → „Handy (iPhone und iPad)“ → „Handy koppeln“. Dort erscheint ein QR-Code.')));
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
      await pair(p, null);
      s.close();
      toast('Gekoppelt mit ' + p.pc);
      go('#/dateien');
      return;
    } catch (e) {
      if (e.code !== 'LOGIN') {
        status.className = 'err-text center';
        status.textContent = e.code === 'KEY' ? e.message : 'Koppeln hat nicht geklappt: ' + e.message;
        return;
      }
    }
    // Schritt 2: pCloud-Anmeldung (pCloud erlaubt Web-Apps das Lesen von Dateien meist nur damit)
    clear(body).append(loginForm({
      intro: `Code von „${p.pc}“ erkannt. pCloud verlangt jetzt noch deine Anmeldung, mit demselben Konto wie am PC.`,
      button: 'Anmelden und koppeln',
      async submit(login, st) {
        st.className = 'muted center';
        st.textContent = 'Verbinde mit pCloud …';
        try {
          await pair(p, login);
          s.close();
          toast('Gekoppelt mit ' + p.pc);
          go('#/dateien');
        } catch (e) {
          st.className = 'err-text center';
          st.textContent = e.code === 'KEY' || e.code === 'LOGIN' ? e.message : 'Koppeln hat nicht geklappt: ' + e.message;
        }
      },
    }));
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

// ---------------------------------------------------------------- pCloud-Anmeldung (E-Mail und Passwort)

function loginForm({ intro, button, submit }) {
  const user = h('input.input', { type: 'email', placeholder: 'E-Mail bei pCloud', autocomplete: 'username', autocapitalize: 'off', autocorrect: 'off', spellcheck: false });
  const pass = h('input.input', { type: 'password', placeholder: 'Passwort bei pCloud', autocomplete: 'current-password' });
  const st = h('p.muted.center', '');
  const go_ = () => {
    if (!user.value.trim() || !pass.value) { st.className = 'err-text center'; st.textContent = 'Bitte E-Mail und Passwort eingeben.'; return; }
    submit({ user: user.value.trim(), pass: pass.value }, st);
  };
  pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') go_(); });
  return h('form.pairing.login', { onsubmit: (e) => { e.preventDefault(); go_(); } },
    h('p', intro),
    h('p.muted.small', 'Warum? pCloud lässt Apps im Browser Dateien nur mit deiner Anmeldung öffnen. Das Passwort bleibt verschlüsselt nur auf diesem Gerät und geht nur direkt an pCloud.'),
    user, pass,
    h('button.btn.primary.block', { type: 'submit' }, button),
    st);
}

/** Anmeldung nachholen oder ändern (Einstellungen, oder wenn sie fehlt). */
export function openLogin({ reason } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet(loginForm({
      intro: reason || 'Mit deinem pCloud-Konto anmelden (dasselbe wie am PC).',
      button: 'Anmelden',
      async submit(login, st) {
        st.className = 'muted center';
        st.textContent = 'Prüfe Anmeldung …';
        try {
          await setPcloudLogin(login);
          done = true;
          s.close();
          toast('Bei pCloud angemeldet');
          resolve(true);
        } catch (e) { st.className = 'err-text center'; st.textContent = e.message; }
      },
    }), { title: 'pCloud-Anmeldung', onClose: () => { if (!done) resolve(false); } });
  });
}
