// Google Drive (API v3). Google kennt keine Pfade, nur Ordner-Kennungen: die App merkt sich, welcher Pfad welche Kennung hat.
// Google-Dokumente (Docs, Tabellen, Präsentationen) werden zum Ansehen als PDF geholt.

import { OAuthBase } from './oauth.js';
import { SourceError, joinPath, parentPath, baseName, BlobCache, xhr } from './base.js';

const API = 'https://www.googleapis.com/drive/v3/';
const UP = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,size,modifiedTime,thumbnailLink,hasThumbnail,sha256Checksum,parents';
const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export class GDriveSource extends OAuthBase {
  static type = 'gdrive';
  static label = 'Google Drive';
  constructor(conn, secret) { super(conn, secret); this.ids = new Map([['/', 'root']]); this.blobs = new BlobCache(6); }

  toItem(m, folder) {
    const isFolder = m.mimeType === FOLDER;
    const path = joinPath(folder, m.name);
    if (isFolder) this.ids.set(path.toLowerCase(), m.id);
    return {
      name: m.name, isFolder, size: Number(m.size) || 0,
      mtime: Date.parse(m.modifiedTime) || 0, id: m.id, path, mime: m.mimeType, thumb: !!m.thumbnailLink, thumbLink: m.thumbnailLink || null,
      google: !isFolder && m.mimeType?.startsWith('application/vnd.google-apps.'), sha256: m.sha256Checksum || null,
    };
  }

  async info() {
    const j = await this.json(API + 'about?fields=user(emailAddress,permissionId),storageQuota');
    return { email: j.user.emailAddress, used: Number(j.storageQuota?.usage) || 0, total: Number(j.storageQuota?.limit) || 0, key: 'gdrive:' + j.user.permissionId };
  }

  /** Kennung eines Ordners oder einer Datei zu einem Pfad (Schritt für Schritt von oben). */
  async idOf(path, { file = false } = {}) {
    if (!path || path === '/') return 'root';
    const k = path.toLowerCase();
    if (!file && this.ids.has(k)) return this.ids.get(k);
    const pid = await this.idOf(parentPath(path));
    const name = baseName(path);
    const j = await this.json(`${API}files?q=${encodeURIComponent(`'${pid}' in parents and name = '${q(name)}' and trashed = false`)}&fields=files(id,mimeType)&pageSize=10`);
    const hit = (j.files || []).find((f) => (file ? f.mimeType !== FOLDER : f.mimeType === FOLDER)) || (j.files || [])[0];
    if (!hit) throw new SourceError('Nicht gefunden.', { notFound: true, detail: 'Google Drive: ' + path });
    if (hit.mimeType === FOLDER) this.ids.set(k, hit.id);
    return hit.id;
  }

  async list(path) {
    const id = await this.idOf(path);
    const out = [];
    let token = '';
    do {
      const j = await this.json(`${API}files?q=${encodeURIComponent(`'${id}' in parents and trashed = false`)}&fields=nextPageToken,files(${FIELDS})&pageSize=1000${token ? '&pageToken=' + token : ''}`);
      for (const m of j.files || []) out.push(this.toItem(m, path));
      token = j.nextPageToken || '';
    } while (token);
    return out;
  }

  async search(path, text) {
    const j = await this.json(`${API}files?q=${encodeURIComponent(`name contains '${q(text)}' and trashed = false`)}&fields=files(${FIELDS})&pageSize=100`);
    const names = new Map();
    const base = path === '/' ? '' : path.toLowerCase();
    const out = [];
    for (const m of j.files || []) {
      const folder = m.parents ? await this._folderPath(m.parents[0], names) : '/';
      const it = this.toItem(m, folder);
      if (!base || it.path.toLowerCase().startsWith(base + '/')) out.push(it);
    }
    return out;
  }
  async _folderPath(id, names) {
    const parts = [];
    let cur = id;
    for (let i = 0; i < 30 && cur; i++) {
      if (!names.has(cur)) names.set(cur, await this.json(`${API}files/${cur}?fields=name,parents`).catch(() => null));
      const m = names.get(cur);
      if (!m || !m.parents) break; // oberste Ebene („Meine Ablage“) erreicht
      parts.unshift(m.name);
      cur = m.parents[0];
    }
    return '/' + parts.join('/');
  }

  thumbUrl(item, size = 'm') { return item.thumbLink ? item.thumbLink.replace(/=s\d+$/, size === 'l' ? '=s1600' : '=s400') : null; }

  async blob(item) {
    const id = item.id || await this.idOf(item.path, { file: true });
    const url = item.google ? `${API}files/${id}/export?mimeType=application/pdf` : `${API}files/${id}?alt=media`;
    return (await this.req(url)).blob();
  }
  async mediaUrl(item) {
    const k = item.id || item.path;
    return this.blobs.get(k) || this.blobs.set(k, URL.createObjectURL(await this.blob(item)));
  }

  async readText(path) {
    let id;
    try { id = await this.idOf(path, { file: true }); } catch (e) { if (e.notFound) return null; throw e; }
    return (await this.req(`${API}files/${id}?alt=media`)).text();
  }

  async _ensureFolder(path) {
    try { return await this.idOf(path); } catch (e) {
      if (!e.notFound) throw e;
      const pid = await this._ensureFolder(parentPath(path));
      const m = await this.json(API + 'files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: baseName(path), mimeType: FOLDER, parents: [pid] }) });
      this.ids.set(path.toLowerCase(), m.id);
      return m.id;
    }
  }

  async writeText(path, text) {
    let id = null;
    try { id = await this.idOf(path, { file: true }); } catch (e) { if (!e.notFound) throw e; }
    if (id) { await this.req(`${UP}/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text }); return; }
    const pid = await this._ensureFolder(parentPath(path));
    await this._multipart({ name: baseName(path), parents: [pid] }, new Blob([text], { type: 'application/json' }));
  }

  async _multipart(meta, blob, opts = {}) {
    const fd = new Blob([
      '--orbit\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n', JSON.stringify(meta), '\r\n--orbit\r\nContent-Type: ' + (blob.type || 'application/octet-stream') + '\r\n\r\n', blob, '\r\n--orbit--',
    ]);
    const r = await xhr('POST', UP + '?uploadType=multipart&fields=id', fd, { headers: { Authorization: 'Bearer ' + await this.token(), 'Content-Type': 'multipart/related; boundary=orbit' }, ...opts });
    if (r.status >= 300) throw new SourceError('Hochladen zu Google Drive fehlgeschlagen.', { code: r.status, detail: 'Google Drive upload: ' + r.status + ' ' + JSON.stringify(r.body || '').slice(0, 200) });
    return r.body;
  }

  async mkdir(parent, name) {
    const pid = await this.idOf(parent);
    const j = await this.json(`${API}files?q=${encodeURIComponent(`'${pid}' in parents and name = '${q(name)}' and trashed = false`)}&fields=files(id)`);
    if (j.files?.length) throw new SourceError('Hier gibt es schon etwas mit diesem Namen.', { code: 409 });
    await this.json(API + 'files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [pid] }) });
  }

  async rename(item, name) {
    await this.json(`${API}files/${item.id}?fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    if (item.isFolder) this._forget(item.path);
  }

  async move(item, toFolder, name = item.name) {
    const from = await this.idOf(parentPath(item.path));
    const to = await this.idOf(toFolder);
    await this.json(`${API}files/${item.id}?addParents=${to}&removeParents=${from}&fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    if (item.isFolder) this._forget(item.path);
  }

  async copy(item, toFolder, name = item.name) {
    const to = await this.idOf(toFolder);
    if (!item.isFolder) {
      await this.json(`${API}files/${item.id}/copy?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parents: [to] }) });
      return;
    }
    // Ordner kopiert Google nicht selbst: Ordner anlegen und den Inhalt einzeln kopieren
    await this.mkdir(toFolder, name);
    const dest = joinPath(toFolder, name);
    for (const child of await this.list(item.path)) await this.copy(child, dest, child.name);
  }

  async remove(item) {
    await this.json(`${API}files/${item.id}?fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
    if (item.isFolder) this._forget(item.path);
  }
  _forget(path) { const p = path.toLowerCase(); for (const k of [...this.ids.keys()]) if (k === p || k.startsWith(p + '/')) this.ids.delete(k); }

  async shareLink(item) {
    await this.json(`${API}files/${item.id}/permissions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'reader', type: 'anyone' }) });
    return (await this.json(`${API}files/${item.id}?fields=webViewLink`)).webViewLink;
  }

  async checksum(item) { return item.sha256 ? { algo: 'SHA-256', hex: item.sha256.toLowerCase() } : null; }

  async upload(file, folder, name, { onProgress, signal, state = {} } = {}) {
    const pid = await this.idOf(folder);
    if (file.size <= 5 * 1024 * 1024) { await this._multipart({ name, parents: [pid] }, file, { onProgress, signal }); return; }
    if (!state.url) {
      const r = await this.req(UP + '?uploadType=resumable', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Length': String(file.size) }, body: JSON.stringify({ name, parents: [pid] }) });
      state.url = r.headers.get('Location'); state.offset = 0;
      if (!state.url) throw new SourceError('Google Drive hat keine Adresse zum Hochladen geliefert.', { detail: 'Google Drive resumable: kein Location-Kopf' });
    }
    const CHUNK = 256 * 1024 * 40; // 10 MiB, Vielfaches von 256 KiB
    while (state.offset < file.size) {
      const end = Math.min(file.size, state.offset + CHUNK);
      const r = await xhr('PUT', state.url, file.slice(state.offset, end), { headers: { 'Content-Range': `bytes ${state.offset}-${end - 1}/${file.size}` }, signal, onProgress: (n) => onProgress && onProgress(state.offset + n) });
      if (r.status === 308) { const rg = r.header('Range'); state.offset = rg ? parseInt(rg.split('-')[1], 10) + 1 : end; continue; }
      if (r.status >= 300) { if (r.status === 404 || r.status === 410) state.url = null; throw new SourceError('Hochladen zu Google Drive fehlgeschlagen.', { code: r.status, detail: 'Google Drive upload: ' + r.status }); }
      state.offset = end;
    }
  }
}
