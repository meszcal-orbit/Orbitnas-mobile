// Gemeinsames für alle Quellen (Clouds): Fehler, Pfade, Namensregel, Zwischenspeicher für geladene Dateien.
//
// Jede Quelle bietet dieselben Bausteine (siehe README „Quellen“):
//   info() → { email, used, total, key }      key = Kennung für die Einstellungsdatei, z. B. "pcloud:123"
//   list(path) → [item]                          path: "/" oder "/Fotos/Urlaub"
//   mediaUrl(item) → URL zum Ansehen/Abspielen  blob(item) → Blob
//   thumbUrl(item, size) → URL | null           (size: 'm' klein, 'l' groß)
//   mkdir(parentPath, name), rename(item, name), remove(item)
//   move(item, toFolderPath, name), copy(item, toFolderPath, name)
//   upload(file, folderPath, name, { onProgress, signal })
//   optional: checksum(item), shareLink(item), search(path, q), readText(path), writeText(path, text)
// item = { name, isFolder, size, mtime, id, path, thumb, mime }

export class SourceError extends Error {
  constructor(message, { code = null, detail = '', login = false, offline = false, notFound = false } = {}) {
    super(message);
    this.code = code;
    this.detail = detail;
    this.login = login;
    this.offline = offline;
    this.notFound = notFound;
  }
}
export const offlineError = () => new SourceError('Keine Internetverbindung.', { offline: true });

export const joinPath = (folder, name) => (folder === '/' ? '' : folder.replace(/\/+$/, '')) + '/' + name;
export const parentPath = (p) => { const i = p.replace(/\/+$/, '').lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); };
export const baseName = (p) => p.replace(/\/+$/, '').split('/').pop() || '';
/** Pfad für die Einstellungsdatei: ohne Schrägstrich am Anfang/Ende, Wurzel = "". */
export const relPath = (p) => (p || '').replace(/^\/+|\/+$/g, '');

export function uniqueName(name, taken) {
  if (!taken.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const c = `${base} (${n})${ext}`;
    if (!taken.has(c.toLowerCase())) return c;
  }
}

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/plain', log: 'text/plain', html: 'text/html', json: 'application/json', csv: 'text/csv',
};
export const mimeOf = (name = '') => MIME[(name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

/** Merkt sich die letzten geladenen Dateien als blob:-Adresse (spart erneutes Laden beim Blättern). */
export class BlobCache {
  constructor(max = 6) { this.max = max; this.map = new Map(); }
  get(k) { return this.map.get(k); }
  set(k, url) {
    this.map.set(k, url);
    while (this.map.size > this.max) {
      const [key, u] = this.map.entries().next().value;
      this.map.delete(key);
      setTimeout(() => URL.revokeObjectURL(u), 60000);
    }
    return url;
  }
}

export async function sha1hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hochladen mit Fortschritt (fetch kann das in Safari nicht). */
export function xhr(method, url, body, { headers = {}, onProgress, signal, responseType = 'json' } = {}) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    x.responseType = responseType;
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => onProgress && onProgress(e.loaded);
    x.onload = () => resolve({ status: x.status, body: x.response, header: (n) => x.getResponseHeader(n) });
    x.onerror = () => reject(offlineError());
    x.onabort = () => reject(new DOMException('Abgebrochen', 'AbortError'));
    if (signal) signal.addEventListener('abort', () => x.abort(), { once: true });
    x.send(body);
  });
}
