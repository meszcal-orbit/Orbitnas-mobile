// OneDrive über Microsoft Graph. Videos und Bilder kommen über die direkte Download-Adresse von Microsoft (streamt sofort).

import { OAuthBase } from './oauth.js';
import { SourceError, joinPath, xhr } from './base.js';

const G = 'https://graph.microsoft.com/v1.0/me/drive';
const enc = (p) => p.split('/').filter(Boolean).map(encodeURIComponent).join('/');
const byPath = (p) => (p === '/' || !p ? G + '/root' : `${G}/root:/${enc(p)}:`);

function toItem(m, folder) {
  const t = m.thumbnails?.[0];
  return {
    name: m.name, isFolder: !!m.folder, size: m.size || 0, mtime: Date.parse(m.lastModifiedDateTime) || 0, id: m.id,
    path: joinPath(folder, m.name), mime: m.file?.mimeType || '', thumb: !!t,
    thumbs: t ? { m: t.medium?.url, l: t.large?.url } : null, dl: m['@microsoft.graph.downloadUrl'] || null, sha1: m.file?.hashes?.sha1Hash || null,
  };
}

export class OneDriveSource extends OAuthBase {
  static type = 'onedrive';
  static label = 'OneDrive';

  async info() {
    const d = await this.json(G + '?$select=id,quota,owner');
    const me = await this.json('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName').catch(() => ({}));
    return { email: me.mail || me.userPrincipalName || d.owner?.user?.displayName || '', used: d.quota?.used, total: d.quota?.total, key: 'onedrive:' + d.id.toLowerCase() };
  }

  async list(path) {
    let url = (path === '/' ? G + '/root' : byPath(path)) + '/children?$top=999&$expand=thumbnails';
    const out = [];
    while (url) {
      const j = await this.json(url);
      for (const m of j.value || []) out.push(toItem(m, path));
      url = j['@odata.nextLink'] || null;
    }
    return out;
  }

  async search(path, q) {
    const j = await this.json(`${G}/root/search(q='${encodeURIComponent(q.replace(/'/g, "''"))}')?$top=200&$expand=thumbnails`);
    const base = path === '/' ? '' : path.toLowerCase();
    return (j.value || []).map((m) => {
      const parent = decodeURIComponent((m.parentReference?.path || '').replace(/^\/drive\/root:?/, '')) || '/';
      return toItem(m, parent);
    }).filter((it) => !base || it.path.toLowerCase().startsWith(base + '/'));
  }

  thumbUrl(item, size = 'm') { return item.thumbs ? item.thumbs[size] || item.thumbs.m : null; }

  async _dl(item) {
    if (item.dl && Date.now() - (item._at || 0) < 50 * 60000) return item.dl;
    const m = await this.json(byPath(item.path) + '?select=id,@microsoft.graph.downloadUrl');
    item.dl = m['@microsoft.graph.downloadUrl'];
    item._at = Date.now();
    return item.dl;
  }
  mediaUrl(item) { return this._dl(item); }
  async blob(item) {
    const res = await fetch(await this._dl(item)).catch(() => { throw new SourceError('Keine Internetverbindung.', { offline: true }); });
    if (!res.ok) throw new SourceError('OneDrive gibt die Datei nicht heraus.', { code: res.status, detail: 'OneDrive download: ' + res.status });
    return res.blob();
  }

  async readText(path) {
    const r = await this.req(byPath(path) + '/content', {}, { okStatus: [404] });
    return r.status === 404 ? null : r.text();
  }
  async writeText(path, text) {
    await this.req(byPath(path) + '/content', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: text });
  }

  async _id(path) { return (await this.json(byPath(path) + '?select=id')).id; }

  async mkdir(parent, name) {
    await this.json((parent === '/' ? G + '/root' : byPath(parent)) + '/children', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
    });
  }

  rename(item, name) {
    return this.json(`${G}/items/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  }

  async move(item, toFolder, name = item.name) {
    return this.json(`${G}/items/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parentReference: { id: await this._id(toFolder) } }) });
  }

  async copy(item, toFolder, name = item.name) {
    const r = await this.req(`${G}/items/${item.id}/copy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parentReference: { id: await this._id(toFolder) } }) });
    // Microsoft kopiert im Hintergrund: kurz warten, bis es fertig ist
    const mon = r.headers.get('Location');
    for (let i = 0; mon && i < 40; i++) {
      await new Promise((res) => setTimeout(res, 750));
      const s = await fetch(mon).then((x) => x.json()).catch(() => null);
      if (!s || s.status === 'completed') return;
      if (s.status === 'failed') throw new SourceError('OneDrive konnte nicht kopieren.', { detail: 'OneDrive copy: ' + JSON.stringify(s.error || s) });
    }
  }

  remove(item) { return this.req(`${G}/items/${item.id}`, { method: 'DELETE' }); }

  async shareLink(item) {
    const j = await this.json(`${G}/items/${item.id}/createLink`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'view', scope: 'anonymous' }) });
    return j.link.webUrl;
  }

  async checksum(item) { return item.sha1 ? { algo: 'SHA-1', hex: item.sha1.toLowerCase() } : null; }

  async upload(file, folder, name, { onProgress, signal, state = {} } = {}) {
    const target = `${byPath(joinPath(folder, name))}`;
    if (file.size <= 4 * 1024 * 1024) {
      const r = await xhr('PUT', target + '/content?@microsoft.graph.conflictBehavior=fail', file, { headers: { Authorization: 'Bearer ' + await this.token(), 'Content-Type': 'application/octet-stream' }, onProgress, signal });
      if (r.status >= 300) throw await this.error(new Response(JSON.stringify(r.body), { status: r.status }), target);
      return;
    }
    if (!state.url) {
      const s = await this.json(target + '/createUploadSession', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'fail' } }) });
      state.url = s.uploadUrl; state.offset = 0;
    } else {
      const s = await fetch(state.url).then((x) => x.json()).catch(() => null);
      state.offset = s?.nextExpectedRanges ? parseInt(s.nextExpectedRanges[0], 10) : 0;
    }
    const CHUNK = 320 * 1024 * 32; // 10 MiB, ein Vielfaches von 320 KiB wie verlangt
    while (state.offset < file.size) {
      const end = Math.min(file.size, state.offset + CHUNK);
      const r = await xhr('PUT', state.url, file.slice(state.offset, end), { headers: { 'Content-Range': `bytes ${state.offset}-${end - 1}/${file.size}` }, signal, onProgress: (n) => onProgress && onProgress(state.offset + n) });
      if (r.status >= 300) { state.url = null; throw new SourceError('Hochladen zu OneDrive fehlgeschlagen.', { code: r.status, detail: 'OneDrive upload: ' + r.status + ' ' + JSON.stringify(r.body || '').slice(0, 200) }); }
      state.offset = end;
    }
  }
}
