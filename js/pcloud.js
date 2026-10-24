// Direkter Zugriff auf pCloud (offizielle API, nur HTTPS). Der Zugang (Token) kommt beim Koppeln vom PC.
// Lesen von Dateiinhalten erlaubt pCloud Web-Apps nur mit E-Mail und Passwort („getzip“ mit Digest),
// nicht mit dem Token und nicht über getfilelink (Fehler 7010 „Invalid link referer“).

import { firstFileFromZip } from './unzip.js';

const MESSAGES = {
  1000: 'Die Kopplung mit pCloud ist ungültig. Bitte am PC neu koppeln.',
  2000: 'Die Kopplung mit pCloud ist ungültig. Bitte am PC neu koppeln.',
  2094: 'Die Kopplung mit pCloud ist ungültig. Bitte am PC neu koppeln.',
  2095: 'Die Kopplung mit pCloud ist ungültig. Bitte am PC neu koppeln.',
  2003: 'Dafür fehlt die Berechtigung.',
  2004: 'Hier gibt es schon etwas mit diesem Namen.',
  2005: 'Der Ordner wurde nicht gefunden.',
  2009: 'Die Datei wurde nicht gefunden.',
  2008: 'Dein pCloud-Speicher ist voll.',
  2001: 'Der Name ist ungültig.',
  2023: 'Ein Ordner kann nicht in sich selbst kopiert oder verschoben werden.',
  4000: 'Zu viele Anfragen. Bitte kurz warten.',
  5000: 'pCloud ist gerade nicht erreichbar. Bitte später noch einmal.',
};

export class ApiError extends Error {
  constructor(code, message) {
    super(MESSAGES[code] || message || 'Fehler bei pCloud');
    this.code = code;
    this.auth = [1000, 2000, 2094, 2095].includes(code);
    this.notFound = code === 2005 || code === 2009;
  }
}
export class LoginError extends Error {
  constructor(message) { super(message || 'Bitte bei pCloud anmelden (Einstellungen → pCloud-Anmeldung).'); this.code = 'LOGIN'; this.login = true; }
}
const LOGIN_MESSAGES = {
  2000: 'E-Mail oder Passwort von pCloud stimmt nicht.',
  2297: 'Bei pCloud ist die Zwei-Faktor-Anmeldung an. Das kann die App noch nicht. Bitte Claude Bescheid geben, dann wird es nachgerüstet.',
  4000: 'Zu viele Anmeldeversuche. Bitte ein paar Minuten warten.',
};

async function sha1hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac',
  pdf: 'application/pdf', txt: 'text/plain', html: 'text/html', json: 'application/json', csv: 'text/csv' };
const mimeOf = (name = '') => MIME[(name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

export class OfflineError extends Error {
  constructor() { super('Keine Internetverbindung.'); this.offline = true; }
}

const join = (a, b) => (a.endsWith('/') ? a : a + '/') + b;

function toItem(m, parentPath) {
  return {
    name: m.name,
    isFolder: !!m.isfolder,
    size: m.size || 0,
    mtime: Date.parse(m.modified) || 0,
    fileid: m.fileid,
    folderid: m.folderid,
    thumb: !!m.thumb,
    contenttype: m.contenttype || '',
    path: join(parentPath, m.name),
  };
}

export class PCloud {
  constructor({ host, token, login }) {
    this.host = host || 'api.pcloud.com';
    this.token = token;
    this.login = login || null;
    this.blobs = new Map();
  }

  setLogin(login) { this.login = login || null; }

  // ---------------------------------------------------------------- Anmeldung mit E-Mail und Passwort (nur fürs Lesen)

  async _getJson(url) {
    let res;
    try { res = await fetch(url, { cache: 'no-store' }); } catch { throw new OfflineError(); }
    if (!res.ok) throw new ApiError(5000, 'HTTP ' + res.status);
    return res.json();
  }

  /** Frische Anmelde-Angaben für genau eine Anfrage (Digest gilt bei pCloud nur kurz). */
  async _signed(login = this.login) {
    if (!login) throw new LoginError();
    const d = await this._getJson(`https://${this.host}/getdigest`);
    if (d.result !== 0) throw new ApiError(d.result, d.error);
    const passworddigest = await sha1hex(login.pass + await sha1hex(login.user.toLowerCase()) + d.digest);
    return { username: login.user, digest: d.digest, passworddigest };
  }

  _signedUrl(method, params, auth) {
    return `https://${this.host}/${method}?${new URLSearchParams({ ...params, ...auth })}`;
  }

  /** Prüft E-Mail und Passwort. Liefert die E-Mail des Kontos. */
  async checkLogin(login) {
    const j = await this._getJson(this._signedUrl('userinfo', {}, await this._signed(login)));
    if (j.result !== 0) throw new LoginError(LOGIN_MESSAGES[j.result] || ('pCloud-Anmeldung abgelehnt: ' + (j.error || j.result)));
    return j.email;
  }

  /** Inhalt einer Datei als Bytes (über getzip). */
  async _bytes(item) {
    let fileid = item.fileid;
    if (!fileid) fileid = (await this.api('stat', { path: item.path })).metadata.fileid;
    const url = this._signedUrl('getzip', { fileids: fileid, filename: 'datei.zip' }, await this._signed());
    let res;
    try { res = await fetch(url, { cache: 'no-store' }); } catch { throw new OfflineError(); }
    if (!res.ok) throw new ApiError(5000, 'HTTP ' + res.status);
    if ((res.headers.get('content-type') || '').includes('json')) {
      const j = await res.json();
      if (j.result === 2000) throw new LoginError(LOGIN_MESSAGES[2000] + ' Bitte unter Einstellungen → pCloud-Anmeldung neu eingeben.');
      if (LOGIN_MESSAGES[j.result]) throw new LoginError(LOGIN_MESSAGES[j.result]);
      throw new ApiError(j.result, j.error);
    }
    return firstFileFromZip(new Uint8Array(await res.arrayBuffer()));
  }

  /** Vorschaubild über die Anmeldung, falls pCloud es mit dem Token nicht ausliefert. */
  async thumbBlobUrl(fileid, size = '256x256') {
    const res = await fetch(this._signedUrl('getthumb', { fileid, size, crop: 1 }, await this._signed()), { cache: 'force-cache' });
    if (!res.ok || (res.headers.get('content-type') || '').includes('json')) throw new Error('kein Vorschaubild');
    return URL.createObjectURL(await res.blob());
  }

  url(method, params = {}) {
    const q = new URLSearchParams({ ...params, access_token: this.token });
    return `https://${this.host}/${method}?${q}`;
  }

  async api(method, params = {}, { body, signal } = {}) {
    let res;
    try {
      res = await fetch(this.url(method, params), body ? { method: 'POST', body, signal } : { signal, cache: 'no-store' });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new OfflineError();
    }
    if (!res.ok) throw new ApiError(5000, 'HTTP ' + res.status);
    const j = await res.json();
    if (j.result !== 0) throw new ApiError(j.result, j.error);
    return j;
  }

  async userinfo() {
    const j = await this.api('userinfo');
    return { email: j.email, used: j.usedquota, total: j.quota, free: Math.max(0, j.quota - j.usedquota) };
  }

  async list(path) {
    const j = await this.api('listfolder', { path });
    const meta = j.metadata;
    return { folderid: meta.folderid, items: (meta.contents || []).map((m) => toItem(m, path)) };
  }

  /** Ganzer Baum ab einem Ordner (für die Suche). Liefert flache Liste. */
  async tree(folderid, path) {
    const j = await this.api('listfolder', { folderid, recursive: 1 });
    const out = [];
    const walk = (m, p) => {
      for (const c of m.contents || []) {
        const it = toItem(c, p);
        out.push(it);
        if (c.isfolder) walk(c, it.path);
      }
    };
    walk(j.metadata, path);
    return out;
  }

  thumbUrl(fileid, size = '256x256') {
    return this.url('getthumb', { fileid, size, crop: 1 });
  }

  /** Adresse zum Ansehen/Abspielen: die Datei wird ganz geladen und als lokale Adresse (blob:) bereitgestellt. */
  async fileLink(item) {
    const id = item.fileid || item.path;
    if (this.blobs.has(id)) return this.blobs.get(id);
    const bytes = await this._bytes(item);
    const url = URL.createObjectURL(new Blob([bytes], { type: item.contenttype || mimeOf(item.name || item.path) }));
    this.blobs.set(id, url);
    // Nur die letzten Dateien im Speicher behalten
    while (this.blobs.size > 6) {
      const [k, u] = this.blobs.entries().next().value;
      this.blobs.delete(k);
      setTimeout(() => URL.revokeObjectURL(u), 60000);
    }
    return url;
  }

  async mkdir(path) {
    const j = await this.api('createfolderifnotexists', { path });
    return toItem(j.metadata, path.slice(0, path.lastIndexOf('/')) || '/');
  }

  rename(item, toname) {
    return item.isFolder
      ? this.api('renamefolder', { folderid: item.folderid, toname })
      : this.api('renamefile', { fileid: item.fileid, toname });
  }

  copy(item, tofolderid) {
    return item.isFolder
      ? this.api('copyfolder', { folderid: item.folderid, tofolderid, noover: 1 })
      : this.api('copyfile', { fileid: item.fileid, tofolderid, noover: 1 });
  }

  move(item, tofolderid) {
    return item.isFolder
      ? this.api('renamefolder', { folderid: item.folderid, tofolderid })
      : this.api('renamefile', { fileid: item.fileid, tofolderid });
  }

  remove(item) {
    return item.isFolder
      ? this.api('deletefolderrecursive', { folderid: item.folderid })
      : this.api('deletefile', { fileid: item.fileid });
  }

  async folderId(path) {
    if (path === '/') return 0;
    const j = await this.api('listfolder', { path, nofiles: 1 });
    return j.metadata.folderid;
  }

  // ---------------------------------------------------------------- Dateien lesen/schreiben (gemeinsame Ablage)

  /** Liest eine Datei als Bytes, oder null, wenn es sie nicht gibt. */
  async readFile(path) {
    let meta;
    try { meta = (await this.api('stat', { path })).metadata; } catch (e) { if (e.notFound) return null; throw e; }
    return this._bytes({ fileid: meta.fileid, path });
  }

  async writeFile(folderPath, name, bytes) {
    await this.mkdir(folderPath);
    const fd = new FormData();
    fd.append('file', new Blob([bytes], { type: 'application/octet-stream' }), name);
    return this.api('uploadfile', { path: folderPath, filename: name, nopartial: 1 }, { body: fd });
  }

  async listNames(path) {
    try { return (await this.list(path)).items; } catch (e) { if (e.notFound) return []; throw e; }
  }

  async deletePath(path) {
    try { await this.api('deletefile', { path }); } catch (e) { if (!e.notFound) throw e; }
  }

  // ---------------------------------------------------------------- Hochladen mit Fortschritt

  /**
   * Lädt eine Datei hoch. Große Dateien in Teilen (bei Abbruch geht es an der Stelle weiter),
   * kleine in einem Stück. state = { uploadid, offset } wird fortgeschrieben, damit ein Neustart weitermachen kann.
   */
  async upload(file, folderid, name, { onProgress, signal, state = {} } = {}) {
    const CHUNK = 8 * 1024 * 1024;
    if (file.size <= 2 * CHUNK || state.single) return this._uploadSingle(file, folderid, name, onProgress, signal);
    try {
      if (!state.uploadid) {
        state.uploadid = (await this.api('upload_create', {}, { signal })).uploadid;
        state.offset = 0;
      } else {
        const info = await this.api('upload_info', { uploadid: state.uploadid }, { signal });
        state.offset = info.size;
      }
      while (state.offset < file.size) {
        if (signal && signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');
        const end = Math.min(file.size, state.offset + CHUNK);
        const part = new Blob([file.slice(state.offset, end)], { type: 'text/plain' });
        await this._xhr(this.url('upload_write', { uploadid: state.uploadid, uploadoffset: state.offset }), part,
          (loaded) => onProgress && onProgress(state.offset + loaded, file.size), signal);
        state.offset = end;
        onProgress && onProgress(state.offset, file.size);
      }
      const j = await this.api('upload_save', { uploadid: state.uploadid, folderid, name }, { signal });
      return j.metadata;
    } catch (e) {
      // Falls pCloud das Hochladen in Teilen aus dem Browser ablehnt: einmal in einem Stück versuchen.
      if (e instanceof ApiError && !e.auth && state.offset === 0 && !state.single) {
        state.single = true;
        state.uploadid = null;
        return this._uploadSingle(file, folderid, name, onProgress, signal);
      }
      throw e;
    }
  }

  async _uploadSingle(file, folderid, name, onProgress, signal) {
    const fd = new FormData();
    fd.append('file', file, name);
    const j = await this._xhr(this.url('uploadfile', { folderid, nopartial: 1, filename: name }), fd,
      (loaded) => onProgress && onProgress(Math.min(loaded, file.size), file.size), signal);
    return j.metadata && j.metadata[0];
  }

  _xhr(url, body, onProgress, signal) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', url);
      x.responseType = 'json';
      x.upload.onprogress = (e) => onProgress && onProgress(e.loaded);
      x.onload = () => {
        const j = x.response;
        if (x.status !== 200 || !j) return reject(new ApiError(5000, 'HTTP ' + x.status));
        if (j.result !== 0) return reject(new ApiError(j.result, j.error));
        resolve(j);
      };
      x.onerror = () => reject(new OfflineError());
      x.onabort = () => reject(new DOMException('Abgebrochen', 'AbortError'));
      if (signal) signal.addEventListener('abort', () => x.abort(), { once: true });
      x.send(body);
    });
  }
}
