// Anmeldedaten der Clouds (Passwörter, Zugangs-Schlüssel). Sie bleiben nur auf diesem Gerät, verschlüsselt mit einem
// Schlüssel, den niemand auslesen kann (nicht exportierbar). Sie kommen nie in die Einstellungsdatei.

import { kv } from './db.js';

async function deviceKey() {
  let key = await kv.get('loginKey');
  if (!key) {
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await kv.set('loginKey', key);
  }
  return key;
}

export async function saveSecret(id, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deviceKey(), new TextEncoder().encode(JSON.stringify(obj))));
  await kv.set('secret:' + id, { iv, ct });
}

export async function loadSecret(id) {
  const s = await kv.get('secret:' + id);
  if (!s) return null;
  try { return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: s.iv }, await deviceKey(), s.ct))); }
  catch { return null; }
}

export const deleteSecret = (id) => kv.del('secret:' + id);

/** Alte Anmeldung aus Version 2 (nur pCloud-Passwort). */
export async function loadOldPcloudLogin() {
  const l = await kv.get('pcloudLogin');
  if (!l) return null;
  try { return { user: l.user, pass: new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: l.iv }, await deviceKey(), l.ct)) }; }
  catch { return null; }
}
