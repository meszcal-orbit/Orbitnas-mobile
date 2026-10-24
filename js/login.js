// pCloud-Anmeldung (E-Mail und Passwort) für das Herunterladen.
// pCloud lässt Web-Apps Dateien nur mit dieser Anmeldung lesen (Methode „getzip“), nicht mit dem Zugang vom PC.
// Das Passwort liegt nur auf diesem Gerät, verschlüsselt mit einem Schlüssel, den niemand auslesen kann (nicht exportierbar).

import { kv } from './db.js';

async function deviceKey() {
  let key = await kv.get('loginKey');
  if (!key) {
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await kv.set('loginKey', key);
  }
  return key;
}

export async function saveLogin(user, pass) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deviceKey(), new TextEncoder().encode(pass)));
  await kv.set('pcloudLogin', { user, iv, ct });
}

export async function loadLogin() {
  const l = await kv.get('pcloudLogin');
  if (!l) return null;
  try {
    const pass = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: l.iv }, await deviceKey(), l.ct));
    return { user: l.user, pass };
  } catch { return null; }
}

export async function hasLogin() { return !!(await kv.get('pcloudLogin')); }

export async function clearLogin() { await kv.del('pcloudLogin'); }
