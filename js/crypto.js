// Verschlüsselung der gemeinsamen Dateien (.onm) und Prüfung der PIN.
// Format siehe SCHNITTSTELLE.md: "ONM1" | Nonce (12) | AES-256-GCM(GZip(JSON)) | Tag (16)

const MAGIC = new TextEncoder().encode('ONM1');

export function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const b64ToBytes = (s) => b64urlToBytes(s);

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
export const gzip = (bytes) => pipe(bytes, new CompressionStream('gzip'));
export const gunzip = (bytes) => pipe(bytes, new DecompressionStream('gzip'));

const keyCache = new Map();
async function aesKey(raw) {
  const id = bytesToB64url(raw);
  if (!keyCache.has(id)) keyCache.set(id, crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
  return keyCache.get(id);
}

export async function encryptOnm(rawKey, aad, obj) {
  const plain = await gzip(new TextEncoder().encode(JSON.stringify(obj)));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(aad) }, await aesKey(rawKey), plain));
  const out = new Uint8Array(4 + 12 + ct.length);
  out.set(MAGIC, 0); out.set(nonce, 4); out.set(ct, 16);
  return out;
}

export async function decryptOnm(rawKey, aad, bytes) {
  bytes = new Uint8Array(bytes);
  if (bytes.length < 32 || MAGIC.some((b, i) => bytes[i] !== b)) throw new Error('Unbekanntes Dateiformat');
  let plain;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(4, 16), additionalData: new TextEncoder().encode(aad) },
      await aesKey(rawKey), bytes.subarray(16));
  } catch {
    const e = new Error('Schlüssel passt nicht. Bitte das Gerät am PC neu koppeln.');
    e.code = 'KEY';
    throw e;
  }
  return JSON.parse(new TextDecoder().decode(await gunzip(new Uint8Array(plain))));
}

/** Prüft eine PIN gegen den Hash des PCs ("pbkdf2-sha256$Runden$Salz$Hash", Base64). */
export async function verifyHash(pin, stored) {
  if (!stored) return true;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = parseInt(parts[1], 10);
  const salt = b64ToBytes(parts[2]);
  const expected = b64ToBytes(parts[3]);
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, expected.length * 8));
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= bits[i] ^ expected[i];
  return diff === 0;
}

/** Erzeugt einen Hash im selben Format wie der PC (für eine eigene App-PIN, falls am PC keine gesetzt ist). */
export async function makeHash(pin, iterations = 600000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256));
  const b64 = (b) => btoa(String.fromCharCode(...b));
  return `pbkdf2-sha256$${iterations}$${b64(salt)}$${b64(bits)}`;
}

/**
 * Fingerabdruck einer Datei für den Doppelt-Schutz: SHA-256 über Größe + erstes und letztes MB.
 * Schnell auch bei großen Videos und unabhängig vom Dateinamen.
 */
export async function fingerprint(file) {
  const MB = 1024 * 1024;
  const head = await file.slice(0, MB).arrayBuffer();
  const tail = file.size > 2 * MB ? await file.slice(file.size - MB).arrayBuffer() : new ArrayBuffer(0);
  const size = new TextEncoder().encode(String(file.size) + ':');
  const all = new Uint8Array(size.length + head.byteLength + tail.byteLength);
  all.set(size, 0); all.set(new Uint8Array(head), size.length); all.set(new Uint8Array(tail), size.length + head.byteLength);
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
  return [...d.subarray(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
