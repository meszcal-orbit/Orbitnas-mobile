// Beispiel-Quelle zum Ausprobieren ohne Cloud. Alles bleibt auf diesem Gerät.

import { kv } from '../db.js';
import { SourceError, joinPath, parentPath, baseName, mimeOf } from './base.js';

const day = 86400000;

function svgImage(label, hue, w = 1200, h = 900) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 256 192"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},70%,35%)"/></linearGradient></defs>` +
    `<rect width="256" height="192" fill="url(#g)"/><circle cx="190" cy="60" r="24" fill="rgba(255,255,255,.55)"/>` +
    `<path d="M0 150 80 90 150 150 190 120 256 160V192H0z" fill="rgba(0,0,0,.3)"/>` +
    `<text x="12" y="180" font-family="-apple-system,Helvetica" font-size="14" fill="#fff">${label}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function seed() {
  const now = Date.now();
  const f = (name, size, age) => ({ name, isFolder: false, size, mtime: now - age * day });
  const d = (name, age = 3) => ({ name, isFolder: true, size: 0, mtime: now - age * day });
  return {
    '/': [d('Fotos', 1), d('Videos', 2), d('Dokumente', 5), d('Musik', 9), d('OrbitNAS', 0), d('.orbitnas', 0)],
    '/OrbitNAS': [d('.verschluesselt', 20), d('.versionen', 20), d('Fotos', 1)],
    '/OrbitNAS/.verschluesselt': [f('LIESMICH.txt', 300, 20)],
    '/OrbitNAS/.versionen': [],
    '/OrbitNAS/Fotos': [f('Sonnenuntergang.jpg', 4200000, 2)],
    '/Fotos': [d('Urlaub 2026', 30), d('Familie', 60), f('Sonnenuntergang.jpg', 4200000, 2), f('Hund im Garten.jpg', 2900000, 4)],
    '/Fotos/Urlaub 2026': Array.from({ length: 12 }, (_, i) => f(`IMG_${4100 + i}.jpg`, 2500000 + i * 90000, 30 + i)),
    '/Fotos/Familie': Array.from({ length: 6 }, (_, i) => f(`Familie_${i + 1}.jpg`, 3100000 + i * 70000, 60 + i)),
    '/Videos': [f('Geburtstag.mov', 1840000000, 12), f('Strand.mp4', 620000000, 31)],
    '/Dokumente': [d('Verträge', 100), f('Steuer 2025.pdf', 1200000, 40), f('Haushaltsbuch.xlsx', 88000, 3), f('Notizen.txt', 400, 1)],
    '/Dokumente/Verträge': [f('Mietvertrag.pdf', 900000, 400), f('Versicherung.pdf', 450000, 200)],
    '/Musik': [f('Sommerlied.mp3', 5200000, 9)],
    '/.orbitnas': [],
  };
}

const TEXTS = { '/Dokumente/Notizen.txt': 'Einkaufen: Milch, Brot, Äpfel\nFRITZ!NAS am iPhone einrichten\n' };

export class DemoSource {
  static type = 'demo';
  constructor() { this.tree = null; this.texts = null; }

  async _load() {
    if (this.tree) return;
    const s = await kv.get('demoTree');
    this.tree = s?.tree || seed();
    this.texts = s?.texts || { ...TEXTS };
  }
  _save() { return kv.set('demoTree', { tree: this.tree, texts: this.texts }); }
  _find(path) {
    const list = this.tree[parentPath(path)];
    const it = list && list.find((x) => x.name.toLowerCase() === baseName(path).toLowerCase());
    if (!it) throw new SourceError('Nicht gefunden.', { notFound: true });
    return { list, it };
  }

  async info() { return { email: 'beispiel@orbit-nas', used: 18.4e9, total: 500e9, key: 'demo:beispiel' }; }

  async list(path) {
    await this._load();
    const items = this.tree[path || '/'];
    if (!items) throw new SourceError('Dieser Ordner wurde nicht gefunden.', { notFound: true });
    return items.map((x) => ({ ...x, id: joinPath(path, x.name), path: joinPath(path, x.name), thumb: /\.(jpe?g|png)$/i.test(x.name), mime: mimeOf(x.name) }));
  }

  async search(path, q) {
    await this._load();
    const n = q.toLowerCase();
    const base = path === '/' ? '' : path.toLowerCase();
    const out = [];
    for (const [p, list] of Object.entries(this.tree)) {
      if (base && p.toLowerCase() !== base && !p.toLowerCase().startsWith(base + '/')) continue;
      for (const x of list) if (x.name.toLowerCase().includes(n)) out.push({ ...x, path: joinPath(p, x.name), id: joinPath(p, x.name), thumb: /\.(jpe?g|png)$/i.test(x.name) });
    }
    return out;
  }

  _hue(path) { let h = 0; for (const c of path) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
  thumbUrl(item) { return item.thumb ? svgImage(item.name, this._hue(item.path), 256, 192) : null; }

  async mediaUrl(item) {
    await this._load();
    if (/\.(jpe?g|png)$/i.test(item.name)) return svgImage(item.name, this._hue(item.path));
    if (this.texts[item.path] != null) return URL.createObjectURL(new Blob([this.texts[item.path]], { type: 'text/plain' }));
    if (this.texts['blob:' + item.path]) return this.texts['blob:' + item.path];
    throw new SourceError('Im Beispiel gibt es hierfür keinen Inhalt.');
  }

  async blob(item) {
    await this._load();
    if (this.texts[item.path] != null) return new Blob([this.texts[item.path]], { type: 'text/plain' });
    const u = await this.mediaUrl(item);
    return (await fetch(u)).blob();
  }

  async readText(path) { await this._load(); return this.texts[path] ?? null; }
  async writeText(path, text) {
    await this._load();
    this.texts[path] = text;
    const list = this.tree[parentPath(path)] || (this.tree[parentPath(path)] = []);
    const ex = list.find((x) => x.name === baseName(path));
    if (ex) { ex.size = text.length; ex.mtime = Date.now(); } else list.push({ name: baseName(path), isFolder: false, size: text.length, mtime: Date.now() });
    await this._save();
  }

  async mkdir(parent, name) {
    await this._load();
    const list = this.tree[parent];
    if (list.some((x) => x.name.toLowerCase() === name.toLowerCase())) throw new SourceError('Hier gibt es schon etwas mit diesem Namen.', { code: 2004 });
    list.push({ name, isFolder: true, size: 0, mtime: Date.now() });
    this.tree[joinPath(parent, name)] = [];
    await this._save();
  }

  _movePrefix(from, to) {
    for (const k of Object.keys(this.tree)) {
      if (k === from || k.startsWith(from + '/')) { this.tree[to + k.slice(from.length)] = this.tree[k]; delete this.tree[k]; }
    }
    for (const k of Object.keys(this.texts)) if (k === from || k.startsWith(from + '/')) { this.texts[to + k.slice(from.length)] = this.texts[k]; delete this.texts[k]; }
  }

  async rename(item, name) {
    await this._load();
    const { list, it } = this._find(item.path);
    if (list.some((x) => x !== it && x.name.toLowerCase() === name.toLowerCase())) throw new SourceError('Hier gibt es schon etwas mit diesem Namen.', { code: 2004 });
    const to = joinPath(parentPath(item.path), name);
    it.name = name;
    this._movePrefix(item.path, to);
    await this._save();
  }

  async move(item, toFolder, name = item.name) {
    await this._load();
    const { list, it } = this._find(item.path);
    const dest = this.tree[toFolder];
    if (!dest) throw new SourceError('Zielordner nicht gefunden.', { notFound: true });
    if (item.isFolder && (toFolder === item.path || toFolder.startsWith(item.path + '/'))) throw new SourceError('Ein Ordner kann nicht in sich selbst verschoben werden.');
    list.splice(list.indexOf(it), 1);
    dest.push({ ...it, name });
    this._movePrefix(item.path, joinPath(toFolder, name));
    await this._save();
  }

  async copy(item, toFolder, name = item.name) {
    await this._load();
    const { it } = this._find(item.path);
    const dest = this.tree[toFolder];
    if (!dest) throw new SourceError('Zielordner nicht gefunden.', { notFound: true });
    dest.push({ ...it, name, mtime: Date.now() });
    const from = item.path, to = joinPath(toFolder, name);
    for (const k of Object.keys(this.tree)) if (k === from || k.startsWith(from + '/')) this.tree[to + k.slice(from.length)] = this.tree[k].map((x) => ({ ...x }));
    if (this.texts[from] != null) this.texts[to] = this.texts[from];
    await this._save();
  }

  async remove(item) {
    await this._load();
    const { list, it } = this._find(item.path);
    list.splice(list.indexOf(it), 1);
    for (const k of Object.keys(this.tree)) if (k === item.path || k.startsWith(item.path + '/')) delete this.tree[k];
    await this._save();
  }

  async upload(file, folder, name, { onProgress } = {}) {
    await this._load();
    for (let i = 1; i <= 5; i++) { await new Promise((r) => setTimeout(r, 60)); onProgress && onProgress((file.size * i) / 5); }
    const list = this.tree[folder];
    list.push({ name, isFolder: false, size: file.size, mtime: Date.now() });
    if (file.size < 200000 && /^text\//.test(file.type)) this.texts[joinPath(folder, name)] = await file.text();
    await this._save();
  }

  async checksum() { return null; }
  async shareLink(item) { return 'https://example.com/beispiel/' + encodeURIComponent(item.name); }
}
