// Beispieldaten, damit man die App ohne Kopplung ausprobieren kann. Nichts davon verlässt das Gerät.

const now = Date.now();
const day = 86400000;
const BASE = 'OrbitNAS';

function svgThumb(label, hue) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},70%,35%)"/></linearGradient></defs>` +
    `<rect width="256" height="256" fill="url(#g)"/><circle cx="190" cy="70" r="28" fill="rgba(255,255,255,.55)"/>` +
    `<path d="M0 200 80 120 150 190 190 150 256 210V256H0z" fill="rgba(0,0,0,.3)"/>` +
    `<text x="16" y="240" font-family="-apple-system,Helvetica" font-size="20" fill="#fff">${label}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

let nextId = 100;
const id = () => nextId++;

function file(name, size, age, extra = {}) {
  return { name, isFolder: false, size, mtime: now - age * day, fileid: id(), thumb: /\.(jpe?g|heic|png)$/i.test(name), ...extra };
}
function folder(name, age = 3) {
  return { name, isFolder: true, size: 0, mtime: now - age * day, folderid: id() };
}

const tree = {
  '/': [folder('Fotos', 1), folder('Videos', 2), folder('Dokumente', 5), folder('Handy-Uploads', 0), folder(BASE, 0)],
  '/Fotos': [folder('Urlaub 2026', 30), folder('Familie', 60), file('Sonnenuntergang.jpg', 4200000, 2), file('Hund im Garten.heic', 2900000, 4)],
  '/Fotos/Urlaub 2026': Array.from({ length: 14 }, (_, i) => file(`IMG_${4100 + i}.HEIC`, 2500000 + i * 90000, 30 + i)),
  '/Fotos/Familie': Array.from({ length: 6 }, (_, i) => file(`Familie_${i + 1}.jpg`, 3100000 + i * 70000, 60 + i)),
  '/Videos': [file('Geburtstag.mov', 1840000000, 12), file('Strand.mp4', 620000000, 31)],
  '/Dokumente': [folder('Verträge', 100), file('Steuer 2025.pdf', 1200000, 40), file('Haushaltsbuch.xlsx', 88000, 3), file('Notizen.txt', 4000, 1)],
  '/Dokumente/Verträge': [file('Mietvertrag.pdf', 900000, 400), file('Versicherung.pdf', 450000, 200)],
  '/Handy-Uploads': [],
  ['/' + BASE]: [folder('Fotos', 0), folder('Dokumente', 0), folder('.versionen', 0), folder('.mobil', 0)],
  ['/' + BASE + '/Fotos']: [folder('Urlaub 2026', 1), file('Sonnenuntergang.jpg', 4200000, 2)],
  ['/' + BASE + '/Dokumente']: [file('Steuer 2025.pdf', 1200000, 40)],
};
const hues = {};
let hue = 10;

function withPaths(path) {
  return (tree[path] || []).map((it) => ({ ...it, path: (path === '/' ? '' : path) + '/' + it.name }));
}
function findPathById(item) {
  for (const [p, list] of Object.entries(tree)) {
    const i = list.findIndex((x) => (item.isFolder ? x.folderid === item.folderid : x.fileid === item.fileid));
    if (i >= 0) return { parent: p, index: i };
  }
  return null;
}
function pathOfFolderId(fid) {
  if (fid === 0) return '/';
  for (const [p, list] of Object.entries(tree)) {
    const f = list.find((x) => x.isFolder && x.folderid === fid);
    if (f) return (p === '/' ? '' : p) + '/' + f.name;
  }
  return null;
}
function err(msg) { const e = new Error(msg); e.code = 2004; return e; }

export class DemoBackend {
  constructor() { this.demo = true; this.host = 'beispiel'; }
  async userinfo() { return { email: 'beispiel@orbit', used: 812e9, total: 2e12, free: 2e12 - 812e9 }; }
  async list(path) {
    if (!tree[path]) { const e = new Error('Der Ordner wurde nicht gefunden.'); e.notFound = true; throw e; }
    const fid = path === '/' ? 0 : withPaths(path.slice(0, path.lastIndexOf('/')) || '/').find((x) => x.path === path)?.folderid;
    return { folderid: fid ?? 0, items: withPaths(path) };
  }
  async tree(folderid, path) {
    const out = [];
    const walk = (p) => { for (const it of withPaths(p)) { out.push(it); if (it.isFolder) walk(it.path); } };
    walk(path);
    return out;
  }
  thumbUrl(fileid) {
    if (!hues[fileid]) { hues[fileid] = hue; hue = (hue + 37) % 360; }
    return svgThumb('Beispiel', hues[fileid]);
  }
  async fileLink(item) {
    if (/\.(jpe?g|heic|png)$/i.test(item.name)) return this.thumbUrl(item.fileid).replace('width="256" height="256"', 'width="1024" height="1024"');
    return null;
  }
  async mkdir(path) {
    const parent = path.slice(0, path.lastIndexOf('/')) || '/';
    const name = path.slice(path.lastIndexOf('/') + 1);
    if (!tree[parent]) tree[parent] = [];
    let f = tree[parent].find((x) => x.name === name && x.isFolder);
    if (!f) { f = folder(name, 0); tree[parent].push(f); tree[path] = []; }
    return { ...f, path };
  }
  async rename(item, toname) {
    const loc = findPathById(item);
    if (tree[loc.parent].some((x) => x.name === toname)) throw err('Hier gibt es schon etwas mit diesem Namen.');
    const old = tree[loc.parent][loc.index];
    if (old.isFolder) {
      const oldP = (loc.parent === '/' ? '' : loc.parent) + '/' + old.name;
      const newP = (loc.parent === '/' ? '' : loc.parent) + '/' + toname;
      for (const k of Object.keys(tree)) if (k === oldP || k.startsWith(oldP + '/')) { tree[newP + k.slice(oldP.length)] = tree[k]; delete tree[k]; }
    }
    old.name = toname;
  }
  async copy(item, tofolderid) {
    const target = pathOfFolderId(tofolderid);
    const src = findPathById(item);
    const it = tree[src.parent][src.index];
    if (tree[target].some((x) => x.name === it.name)) throw err();
    const c = it.isFolder ? folder(it.name, 0) : file(it.name, it.size, 0);
    tree[target].push(c);
    if (it.isFolder) {
      const from = (src.parent === '/' ? '' : src.parent) + '/' + it.name;
      const to = (target === '/' ? '' : target) + '/' + it.name;
      for (const k of Object.keys(tree)) if (k === from || k.startsWith(from + '/')) tree[to + k.slice(from.length)] = tree[k].map((x) => ({ ...x, fileid: x.fileid && id(), folderid: x.folderid && id() }));
    }
  }
  async move(item, tofolderid) {
    await this.copy(item, tofolderid);
    await this.remove(item);
  }
  async remove(item) {
    const loc = findPathById(item);
    if (loc) tree[loc.parent].splice(loc.index, 1);
  }
  async folderId(path) {
    if (path === '/') return 0;
    const parent = path.slice(0, path.lastIndexOf('/')) || '/';
    const f = (tree[parent] || []).find((x) => x.isFolder && (parent === '/' ? '' : parent) + '/' + x.name === path);
    if (!f) { const e = new Error('Der Ordner wurde nicht gefunden.'); e.notFound = true; throw e; }
    return f.folderid;
  }
  async listNames(path) { return withPaths(path); }
  async upload(f, folderid, name, { onProgress, signal } = {}) {
    const target = pathOfFolderId(folderid);
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      if (signal && signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');
      await new Promise((r) => setTimeout(r, 60));
      onProgress && onProgress((f.size * i) / steps, f.size);
    }
    const it = file(name, f.size, 0);
    tree[target].push(it);
    return it;
  }
}

export function demoStatus() {
  return {
    v: 1, generated: new Date(now - 6 * 60000).toISOString(), pc: 'PC (Beispiel)', appVersion: '0.5.1',
    running: null,
    lastBackup: { time: new Date(now - 16 * 3600000).toISOString(), ok: true, message: '' },
    nextBackup: new Date(now + 8 * 3600000).toISOString(),
    locations: [
      { id: 'storage', name: 'Speicher', kind: 'storage', type: '', used: 1.31e12, total: 2e12, free: 0.69e12, online: true },
      { id: 'demo-pcloud', name: 'pCloud', kind: 'cloud', type: 'PCloud', used: 812e9, total: 2e12, free: 1.188e12, online: true, primary: true },
      { id: 'demo-fritz', name: 'FRITZ!NAS', kind: 'disk', type: 'LocalFolder', used: 610e9, total: 1e12, free: 390e9, online: true },
      { id: 'demo-internxt', name: 'Internxt', kind: 'cloud', type: 'Internxt', used: 1.1e12, total: 5e12, free: 3.9e12, online: true },
    ],
    folders: [
      { id: 'f1', name: 'Fotos', path: 'Fotos', mode: 'Mirrored', targets: ['demo-pcloud', 'demo-fritz'], lastSuccess: new Date(now - 16 * 3600000).toISOString(), lastError: null },
      { id: 'f2', name: 'Dokumente', path: 'Dokumente', mode: 'Mirrored', targets: ['demo-pcloud'], lastSuccess: new Date(now - 16 * 3600000).toISOString(), lastError: null },
      { id: 'f3', name: 'Filme', path: 'Filme', mode: 'CloudOnly', targets: ['demo-internxt'], lastSuccess: new Date(now - 9 * day).toISOString(), lastError: null, offloadedBytes: 820e9, offloadedFiles: 214 },
      { id: 'f4', name: 'Musik', path: 'Musik', mode: 'DiskOnly', targets: [], lastSuccess: null, lastError: null },
    ],
    hidden: {},
    pin: null, pinIsPin: true, pinLength: 4,
    // Beispiel-Ordner-PIN für „Privat“: 1234
    locks: [{ location: 'storage', path: 'Privat', hash: 'pbkdf2-sha256$10000$MDEyMzQ1Njc4OWFiY2RlZg==$ixxYM1J8PQqA5j6d5jAkX8XLxDakMhAO4cNeFjzkuVE=', pinLength: 4 }],
    favorites: [
      { location: 'storage', path: 'Fotos/Urlaub 2026', name: 'Urlaub 2026', isFolder: true },
      { location: 'demo-pcloud', path: 'Dokumente', name: 'Dokumente (pCloud)', isFolder: true },
    ],
  };
}

export function demoIndex() {
  const e = [];
  const add = (parent, name, flags, size = 0, ageDays = 5) => { e.push([parent, name, flags, size, Math.round((now - ageDays * day) / 1000)]); return e.length - 1; };
  const fotos = add(-1, 'Fotos', 1 | 8);
  const urlaub = add(fotos, 'Urlaub 2026', 1 | 8);
  for (let i = 0; i < 40; i++) add(urlaub, `IMG_${4100 + i}.HEIC`, 8, 2.6e6 + i * 1e5, 30);
  const fam = add(fotos, 'Familie', 1 | 8);
  for (let i = 0; i < 25; i++) add(fam, `Familie_${i + 1}.jpg`, 8, 3.1e6, 60);
  const docs = add(-1, 'Dokumente', 1 | 8);
  add(docs, 'Steuer 2025.pdf', 8, 1.2e6, 40);
  add(docs, 'Haushaltsbuch.xlsx', 8, 88000, 3);
  const filme = add(-1, 'Filme', 1 | 4);
  ['Der Hobbit.mkv', 'Urlaub Norwegen.mp4', 'Hochzeit.mov', 'Konzert.mp4'].forEach((n, i) => add(filme, n, 4, [12e9, 4.4e9, 21e9, 2.2e9][i], 90));
  const musik = add(-1, 'Musik', 1);
  for (let i = 0; i < 30; i++) add(musik, `Titel ${i + 1}.mp3`, 0, 8e6, 300);
  const privat = add(-1, 'Privat', 1);
  add(privat, 'Tagebuch.docx', 0, 200000, 9);

  const f = [];
  const addF = (parent, name, flags, size = 0, ageDays = 5) => { f.push([parent, name, flags, size, Math.round((now - ageDays * day) / 1000)]); return f.length - 1; };
  const b = addF(-1, 'Backup', 1);
  const bf = addF(b, 'Fotos', 1);
  for (let i = 0; i < 20; i++) addF(bf, `IMG_${4100 + i}.HEIC`, 0, 2.6e6, 30);
  const tv = addF(-1, 'Aufnahmen TV', 1);
  addF(tv, 'Tatort.ts', 0, 3.8e9, 14);
  addF(tv, 'Doku Weltall.ts', 0, 2.1e9, 20);

  return {
    v: 1, generated: new Date(now - 6 * 60000).toISOString(),
    locations: [
      { id: 'storage', name: 'Speicher', kind: 'storage', e },
      { id: 'demo-fritz', name: 'FRITZ!NAS', kind: 'disk', e: f },
    ],
  };
}

export const DEMO_PAIRING = { v: 1, pc: 'PC (Beispiel)', conn: 'demo-pcloud', host: 'beispiel', token: '', base: BASE, key: '', demo: true };
