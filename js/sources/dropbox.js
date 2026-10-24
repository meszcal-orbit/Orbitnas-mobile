// Dropbox (API v2). Bilder und Videos über einen kurzzeitigen Direkt-Link von Dropbox (streamt sofort).

import { OAuthBase } from './oauth.js';
import { SourceError, joinPath, BlobCache, xhr } from './base.js';

const API = 'https://api.dropboxapi.com/2/';
const CONTENT = 'https://content.dropboxapi.com/2/';
const dbxPath = (p) => (p === '/' || !p ? '' : p);
// Dropbox verlangt im Kopf reines ASCII: Umlaute als \uXXXX
const argHeader = (o) => JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

function toItem(m) {
  const folder = m['.tag'] === 'folder';
  return {
    name: m.name, isFolder: folder, size: m.size || 0, mtime: Date.parse(m.server_modified || m.client_modified) || 0, id: m.id,
    path: m.path_display, thumb: !folder && /\.(jpe?g|png|gif|webp|heic|tiff?|bmp)$/i.test(m.name), hash: m.content_hash || null, mime: '',
  };
}

export class DropboxSource extends OAuthBase {
  static type = 'dropbox';
  static label = 'Dropbox';
  constructor(conn, secret) { super(conn, secret); this.thumbs = new BlobCache(300); }

  rpc(name, body) {
    return this.json(API + name, body === undefined ? { method: 'POST' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  async info() {
    const a = await this.rpc('users/get_current_account');
    const u = await this.rpc('users/get_space_usage').catch(() => ({}));
    return { email: a.email, used: u.used, total: u.allocation?.allocated, key: 'dropbox:' + a.account_id };
  }

  async list(path) {
    let j = await this.rpc('files/list_folder', { path: dbxPath(path), limit: 2000 });
    const out = j.entries.map(toItem);
    while (j.has_more) { j = await this.rpc('files/list_folder/continue', { cursor: j.cursor }); out.push(...j.entries.map(toItem)); }
    return out;
  }

  async search(path, q) {
    const j = await this.rpc('files/search_v2', { query: q, options: { path: dbxPath(path), max_results: 200, filename_only: true } });
    return (j.matches || []).map((m) => toItem(m.metadata.metadata));
  }

  async thumbUrl(item, size = 'm') {
    const k = item.path + size;
    if (this.thumbs.get(k)) return this.thumbs.get(k);
    const r = await this.req(CONTENT + 'files/get_thumbnail_v2', { method: 'POST', headers: { 'Dropbox-API-Arg': argHeader({ resource: { '.tag': 'path', path: item.path }, format: 'jpeg', size: size === 'l' ? 'w1024h768' : 'w256h256', mode: size === 'l' ? 'bestfit' : 'fitone_bestfit' }) } });
    return this.thumbs.set(k, URL.createObjectURL(await r.blob()));
  }

  async mediaUrl(item) { return (await this.rpc('files/get_temporary_link', { path: item.path })).link; }
  async blob(item) {
    const r = await this.req(CONTENT + 'files/download', { method: 'POST', headers: { 'Dropbox-API-Arg': argHeader({ path: item.path }) } });
    return r.blob();
  }

  async readText(path) {
    const r = await this.req(CONTENT + 'files/download', { method: 'POST', headers: { 'Dropbox-API-Arg': argHeader({ path }) } }, { okStatus: [409] });
    return r.status === 409 ? null : r.text();
  }
  async writeText(path, text) {
    await this.req(CONTENT + 'files/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': argHeader({ path, mode: 'overwrite', mute: true }) }, body: new Blob([text]) });
  }

  mkdir(parent, name) { return this.rpc('files/create_folder_v2', { path: joinPath(parent, name), autorename: false }); }
  rename(item, name) { return this.rpc('files/move_v2', { from_path: item.path, to_path: joinPath(item.path.slice(0, item.path.lastIndexOf('/')) || '/', name), autorename: false }); }
  move(item, toFolder, name = item.name) { return this.rpc('files/move_v2', { from_path: item.path, to_path: joinPath(toFolder, name), autorename: false }); }
  copy(item, toFolder, name = item.name) { return this.rpc('files/copy_v2', { from_path: item.path, to_path: joinPath(toFolder, name), autorename: false }); }
  remove(item) { return this.rpc('files/delete_v2', { path: item.path }); }

  async shareLink(item) {
    try { return (await this.rpc('sharing/create_shared_link_with_settings', { path: item.path })).url; }
    catch (e) {
      const j = await this.rpc('sharing/list_shared_links', { path: item.path, direct_only: true });
      if (j.links?.[0]) return j.links[0].url;
      throw e;
    }
  }

  async checksum(item) { return item.hash ? { algo: 'DROPBOX', hex: item.hash } : null; }

  async upload(file, folder, name, { onProgress, signal, state = {} } = {}) {
    const path = joinPath(folder, name);
    const auth = async () => ({ Authorization: 'Bearer ' + await this.token(), 'Content-Type': 'application/octet-stream' });
    const fail = (r, what) => new SourceError('Hochladen zu Dropbox fehlgeschlagen.', { code: r.status, detail: `Dropbox ${what}: ${r.status} ${JSON.stringify(r.body || '').slice(0, 200)}` });
    if (file.size <= 140 * 1024 * 1024) {
      const r = await xhr('POST', CONTENT + 'files/upload', file, { headers: { ...(await auth()), 'Dropbox-API-Arg': argHeader({ path, mode: 'add', autorename: false, mute: true }) }, onProgress, signal });
      if (r.status >= 300) throw fail(r, 'upload');
      return;
    }
    const CHUNK = 32 * 1024 * 1024;
    if (!state.session) {
      const r = await xhr('POST', CONTENT + 'files/upload_session/start', new Blob([]), { headers: { ...(await auth()), 'Dropbox-API-Arg': argHeader({ close: false }) }, signal });
      if (r.status >= 300) throw fail(r, 'upload_session/start');
      state.session = r.body.session_id; state.offset = 0;
    }
    while (state.offset < file.size) {
      const end = Math.min(file.size, state.offset + CHUNK);
      const r = await xhr('POST', CONTENT + 'files/upload_session/append_v2', file.slice(state.offset, end), { headers: { ...(await auth()), 'Dropbox-API-Arg': argHeader({ cursor: { session_id: state.session, offset: state.offset }, close: false }) }, signal, onProgress: (n) => onProgress && onProgress(state.offset + n) });
      if (r.status >= 300) { if (r.status === 409) state.session = null; throw fail(r, 'append'); }
      state.offset = end;
    }
    const r = await xhr('POST', CONTENT + 'files/upload_session/finish', new Blob([]), { headers: { ...(await auth()), 'Dropbox-API-Arg': argHeader({ cursor: { session_id: state.session, offset: state.offset }, commit: { path, mode: 'add', autorename: false, mute: true } }) }, signal });
    if (r.status >= 300) throw fail(r, 'finish');
  }
}

/** Dropbox-Prüfsumme einer Datei: SHA-256 je 4-MB-Block, darüber noch einmal SHA-256. */
export async function dropboxHash(file) {
  const B = 4 * 1024 * 1024;
  const parts = [];
  for (let o = 0; o < file.size; o += B) parts.push(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.slice(o, o + B).arrayBuffer())));
  const all = new Uint8Array(parts.length * 32);
  parts.forEach((p, i) => all.set(p, i * 32));
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}
