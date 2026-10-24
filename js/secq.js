// Sicherheitsfrage (wie am PC, Schnittstelle Abschnitt 11): Frage und Antwort wählt Dennis selbst.
// Sie wird zusätzlich abgefragt bei heiklen Schritten: PIN vergessen, PIN ändern oder abschalten.
// Gespeichert wird nur ein Hash der Antwort (PBKDF2-SHA256, 32 Byte; Antwort getrimmt, klein, NFC).

import { h, toast, sheet } from './util.js';
import { security, setSingle } from './store.js';

const ITER = 100000;
const norm = (a) => (a || '').trim().toLowerCase().normalize('NFC');
const b64 = (b) => btoa(String.fromCharCode(...b));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(answer, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(norm(answer)), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256));
}

export const securityQuestion = () => security();

export async function checkAnswer(answer, sec = securityQuestion()) {
  if (!sec) return true;
  const bits = await derive(answer, unb64(sec.salt), sec.iterations || ITER);
  const exp = unb64(sec.hash);
  let diff = bits.length ^ exp.length;
  for (let i = 0; i < exp.length; i++) diff |= bits[i] ^ exp[i];
  return diff === 0;
}

/**
 * Fragt die Sicherheitsfrage ab. Ist keine festgelegt, geht es ohne weiter (liefert true).
 * reason: kurzer Satz, wofür (z. B. „PIN ändern“).
 */
export function askSecurity(reason) {
  const sec = securityQuestion();
  if (!sec) return Promise.resolve(true);
  return new Promise((resolve) => {
    let ok = false;
    const input = h('input.input', { type: 'text', placeholder: 'Deine Antwort', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: false });
    const msg = h('p.err-text', '');
    const submit = async (e) => {
      e?.preventDefault();
      msg.textContent = 'Prüfe …';
      if (await checkAnswer(input.value, sec)) { ok = true; s.close(); return; }
      msg.textContent = 'Die Antwort stimmt nicht.';
      input.select();
    };
    const s = sheet(h('form.dialog-body.secq', { onsubmit: submit },
      h('p.muted.small', 'Zur Sicherheit' + (reason ? ' (' + reason + ')' : '') + ':'),
      h('p.secq-q', sec.question),
      input, msg,
      h('button.btn.primary.block', { type: 'submit' }, 'Bestätigen'),
      h('p.muted.small', 'Groß- und Kleinschreibung sowie Leerzeichen am Anfang und Ende spielen keine Rolle.')),
    { title: 'Sicherheitsfrage', onClose: () => resolve(ok) });
    setTimeout(() => input.focus(), 300);
  });
}

/** Frage festlegen, ändern oder entfernen (gilt am PC und auf allen Handys). */
export async function editSecurity({ remove = false } = {}) {
  if (!(await askSecurity(remove ? 'Sicherheitsfrage entfernen' : 'Sicherheitsfrage ändern'))) return false;
  if (remove) {
    await setSingle('security', null);
    toast('Sicherheitsfrage entfernt');
    return true;
  }
  return new Promise((resolve) => {
    let done = false;
    const q = h('input.input', { type: 'text', placeholder: 'Deine Frage, z. B. „Name meines ersten Hundes?“', value: securityQuestion()?.question || '' });
    const a1 = h('input.input', { type: 'password', placeholder: 'Antwort', autocomplete: 'off' });
    const a2 = h('input.input', { type: 'password', placeholder: 'Antwort wiederholen', autocomplete: 'off' });
    const msg = h('p.err-text', '');
    const submit = async (e) => {
      e.preventDefault();
      if (q.value.trim().length < 3) { msg.textContent = 'Bitte eine Frage eingeben.'; return; }
      if (norm(a1.value).length < 2) { msg.textContent = 'Die Antwort ist zu kurz.'; return; }
      if (norm(a1.value) !== norm(a2.value)) { msg.textContent = 'Die beiden Antworten sind verschieden.'; return; }
      msg.className = 'muted'; msg.textContent = 'Wird gespeichert …';
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const sec = { question: q.value.trim(), salt: b64(salt), hash: b64(await derive(a1.value, salt, ITER)), iterations: ITER };
      await setSingle('security', sec);
      done = true;
      s.close();
      toast('Sicherheitsfrage gespeichert – gilt auch am PC');
      resolve(true);
    };
    const s = sheet(h('form.dialog-body.secq', { onsubmit: submit },
      h('p.muted.small', 'Frage und Antwort wählst du selbst. Sie werden bei heiklen Schritten zusätzlich abgefragt: PIN vergessen, PIN ändern oder abschalten, Ordner-PIN entfernen und (am PC) Verschlüsselung abschalten. Gespeichert wird nur ein unlesbarer Fingerabdruck der Antwort.'),
      q, a1, a2, msg,
      h('button.btn.primary.block', { type: 'submit' }, 'Speichern')),
    { title: 'Sicherheitsfrage', onClose: () => { if (!done) resolve(false); } });
  });
}
