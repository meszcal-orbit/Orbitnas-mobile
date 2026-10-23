// Direkter Zugriff auf pCloud (offizielle API, nur HTTPS). Der Zugang (Token) kommt beim Koppeln vom PC.

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
  constructor({ host, token }) {
    this.host = host || 'api.pcloud.com';
    this.token = token;
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

  async fileLink(item) {
    const j = await this.api('getfilelink', item.fileid ? { fileid: item.fileid } : { path: item.path });
    return 'https://' + j.hosts[0] + j.path;
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
    let link;
    try {
      const j = await this.api('getfilelink', { path });
      link = 'https://' + j.hosts[0] + j.path;
    } catch (e) {
      if (e.notFound) return null;
      throw e;
    }
    let res;
    try { res = await fetch(link, { cache: 'no-store' }); } catch { throw new OfflineError(); }
    if (!res.ok) throw new ApiError(5000, 'HTTP ' + res.status);
    return new Uint8Array(await res.arrayBuffer());
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
