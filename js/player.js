// Wiedergabe in der App wie der Player am PC: Bühne, Infos, „Als Nächstes“ mit Autoplay, Fortsetzen an der letzten Stelle.

import { h, icon, kindOf, kindIcon, KIND_COLOR, fmtSize, fmtDate, toast, clear } from './util.js';
import { state, isDemo } from './sync.js';
import { kv } from './db.js';
import { linkFor, fetchViaPc, download, locName, thumbImg } from './locations.js';

const playable = (k) => k === 'video' || k === 'audio';
const sameGroup = (a, b) => a === b || (playable(a) && playable(b));
const fmtTime = (s) => { s = Math.max(0, Math.floor(s || 0)); const m = Math.floor(s / 60); const hh = Math.floor(m / 60); return (hh ? hh + ':' + String(m % 60).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };

let autoplay = true;

/** Öffnet die Wiedergabe. items: Geschwister im Ordner (Dateien), onMenu(item): „Weitere Aktionen“. */
export function openPlayer(item, items = [item], { onMenu } = {}) {
  const k0 = kindOf(item.name);
  const list = items.filter((x) => !x.isFolder && sameGroup(kindOf(x.name), k0));
  let index = Math.max(0, list.indexOf(item));
  let media = null;
  let saveTimer = null;
  let seq = 0;

  const stage = h('div.pl-stage');
  const title = h('h1.pl-title');
  const meta = h('div.pl-meta');
  const side = h('div.pl-list');
  const auto = h('button.pl-auto' + (autoplay ? '.on' : ''), { onclick: () => { autoplay = !autoplay; auto.classList.toggle('on', autoplay); } }, h('span', 'Autoplay'), h('span.switch'));
  const root = h('div.player', { role: 'dialog', 'aria-modal': 'true' },
    h('div.pl-top', h('button.icon-btn', { 'aria-label': 'Schließen', onclick: () => close() }, icon('close')), h('span.pl-count')),
    h('div.pl-layout' + (list.length < 2 ? '.single' : ''),
      h('div.pl-main', stage, h('div.pl-info', title, meta)),
      h('div.pl-side', h('div.pl-side-head', h('b', playable(k0) ? 'Als Nächstes' : 'Weitere Bilder'), playable(k0) ? auto : null), side)));
  document.body.append(root);
  requestAnimationFrame(() => root.classList.add('show'));

  // Medien-Menü wie am PC (Rechtsklick): am Handy langes Drücken auf das Bild bzw. Video
  const menu = () => { if (!onMenu) return; const it = list[index]; close(); onMenu(it, { fromPlayer: true }); };
  let pressT = null, px = 0, py = 0;
  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    px = e.touches[0].clientX; py = e.touches[0].clientY;
    pressT = setTimeout(() => { pressT = null; navigator.vibrate && navigator.vibrate(15); menu(); }, 550);
  }, { passive: true });
  stage.addEventListener('touchmove', (e) => { if (pressT && Math.hypot(e.touches[0].clientX - px, e.touches[0].clientY - py) > 10) { clearTimeout(pressT); pressT = null; } }, { passive: true });
  stage.addEventListener('touchend', () => { clearTimeout(pressT); pressT = null; });
  stage.addEventListener('contextmenu', (e) => { e.preventDefault(); menu(); });

  function close() {
    savePos();
    clearInterval(saveTimer);
    media?.pause();
    document.removeEventListener('keydown', onKey);
    root.classList.remove('show');
    setTimeout(() => root.remove(), 200);
  }
  const key = (it) => 'pos:' + it.location + ':' + it.rel;
  function savePos() {
    if (!media || !media.duration || !isFinite(media.duration)) return;
    const it = list[index];
    const t = media.currentTime;
    kv.set(key(it), t > 10 && t < media.duration - 15 ? t : 0).catch(() => {});
  }

  async function show(i) {
    savePos();
    clearInterval(saveTimer);
    media?.pause();
    media = null;
    index = (i + list.length) % list.length;
    const it = list[index];
    const my = ++seq;
    const k = kindOf(it.name);
    title.textContent = it.name;
    root.querySelector('.pl-count').textContent = list.length > 1 ? `${index + 1} von ${list.length}` : '';
    clear(meta).append(
      h('span', [fmtSize(it.size), fmtDate(it.mtime), locName(it.location) + (it.rel.includes('/') ? ' › ' + it.rel.slice(0, it.rel.lastIndexOf('/')).replace(/\//g, ' › ') : '')].filter(Boolean).join(' · ')),
      h('span.spacer'),
      h('button.chip', { onclick: () => download(it) }, icon('download'), ' Herunterladen'),
      onMenu ? h('button.chip', { onclick: () => { close(); onMenu(it); } }, icon('more'), ' Weitere Aktionen') : null);
    paintList();
    clear(stage).append(h('div.spinner'));
    let link = null;
    try { link = await linkFor(it); } catch (e) { if (my === seq) showError('Kann nicht geladen werden', e.message); return; }
    if (my !== seq) return;
    if (!link) {
      clear(stage).append(h('div.pl-error', icon(kindIcon[k], 'big'),
        h('div.big', isDemo() ? 'Im Beispiel ohne Inhalt' : 'Diese Datei liegt nur am PC bzw. auf der FRITZ!NAS'),
        isDemo() ? null : h('p.muted', 'Der PC kann sie in pCloud bereitstellen. Das dauert bis zu 2 Minuten, solange Orbit NAS am PC läuft.'),
        isDemo() ? null : h('button.btn.primary', { onclick: async (e) => {
          e.target.disabled = true;
          e.target.textContent = 'Wartet auf den PC …';
          try { await fetchViaPc(it); if (my === seq) show(index); } catch (er) { if (my === seq) showError('Nicht bereitgestellt', er.message); }
        } }, 'Aufs Handy holen')));
      return;
    }
    clear(stage);
    if (k === 'image') showImage(link, it);
    else if (k === 'video' || k === 'audio') await showMedia(link, it, k);
    else if (k === 'pdf') stage.append(h('div.pl-error', icon('pdf', 'big'), h('div.big', it.name), h('button.btn.primary', { onclick: () => window.open(link, '_blank') }, 'PDF öffnen')));
    else if ((k === 'text' || k === 'code') && it.size < 2e6) {
      try { const t = await (await fetch(link)).text(); if (my === seq) stage.append(h('pre.pl-text', t)); } catch (e) { showError('Kann nicht geladen werden', e.message); }
    } else stage.append(h('div.pl-error', icon(kindIcon[k], 'big'), h('div.big', 'Keine Vorschau für diese Art von Datei'),
      h('p.muted', 'Mit „Herunterladen“ kannst du sie in einer anderen App öffnen.')));
    preload();
  }

  function showError(t, text) { clear(stage).append(h('div.pl-error', icon('warn', 'big'), h('div.big', t), h('p.muted', text || ''))); }

  function showImage(link, it) {
    const img = h('img', { src: link, alt: it.name, draggable: false, onerror: () => showError('Kann hier nicht angezeigt werden', 'Dieses Bildformat kann iOS nicht anzeigen.') });
    const box = h('div.pl-zoom', img);
    let zoomed = false;
    let lastTap = 0;
    box.addEventListener('click', (e) => {
      if (Date.now() - lastTap < 300) {
        zoomed = !zoomed;
        box.classList.toggle('zoomed', zoomed);
        if (zoomed) { const r = box.getBoundingClientRect(); box.scrollTo((e.clientX - r.left) * 1.5, (e.clientY - r.top) * 1.5); }
      }
      lastTap = Date.now();
    });
    let sx = null;
    box.addEventListener('touchstart', (e) => { sx = e.touches.length === 1 && !zoomed ? e.touches[0].clientX : null; }, { passive: true });
    box.addEventListener('touchend', (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 60 && list.length > 1) show(index + (dx < 0 ? 1 : -1)); sx = null; });
    stage.append(box);
    if (list.length > 1) stage.append(h('button.pl-nav.l', { 'aria-label': 'Vorheriges', onclick: () => show(index - 1) }, icon('back')), h('button.pl-nav.r', { 'aria-label': 'Nächstes', onclick: () => show(index + 1) }, icon('forward')));
  }

  async function showMedia(link, it, k) {
    const el = h(k === 'video' ? 'video' : 'audio', { src: link, controls: true, playsinline: true, preload: 'metadata', autoplay: true });
    media = el;
    if (k === 'audio') stage.append(h('div.audio-art', h('div.disc'), h('div.name', it.name)));
    stage.append(el);
    el.addEventListener('play', () => stage.querySelector('.audio-art')?.classList.add('playing'));
    el.addEventListener('pause', () => stage.querySelector('.audio-art')?.classList.remove('playing'));
    el.addEventListener('error', () => {
      if (media !== el) return;
      showError('Kann hier nicht abgespielt werden', k === 'video'
        ? 'iPhone und iPad spielen MP4 und MOV ab, aber z. B. kein MKV, AVI oder WMV. Tipp: „Herunterladen“ und mit einer Player-App wie VLC öffnen.'
        : 'Dieses Tonformat spielt iOS nicht ab.');
    });
    el.addEventListener('ended', () => { kv.set(key(it), 0).catch(() => {}); if (autoplay && list.length > 1 && index < list.length - 1) show(index + 1); });
    const pos = await kv.get(key(it)).catch(() => 0);
    if (pos > 10) {
      el.addEventListener('loadedmetadata', () => { el.currentTime = pos; toast(`Weiter bei ${fmtTime(pos)}`); }, { once: true });
    }
    saveTimer = setInterval(savePos, 5000);
  }

  function preload() {
    const nx = list[index + 1];
    if (nx && kindOf(nx.name) === 'image') linkFor(nx).then((l) => { if (l) { const i = new Image(); i.src = l; } }).catch(() => {});
  }

  function paintList() {
    if (list.length < 2) return;
    clear(side).append(...list.map((x, i) => {
      const kx = kindOf(x.name);
      const thumb = x.kind === 'pcloud' && x.thumb ? thumbImg('img', x.fileid, '120x120') : h('span.pl-glyph', { style: { color: KIND_COLOR[kx] } }, icon(kindIcon[kx]));
      return h('button.pl-item' + (i === index ? '.on' : ''), { onclick: () => show(i) }, h('span.pl-thumb', thumb), h('span.pl-name', x.name, h('small', fmtSize(x.size))));
    }));
    side.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }

  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight' && !media) show(index + 1);
    else if (e.key === 'ArrowLeft' && !media) show(index - 1);
    else if (e.key === ' ' && media) { e.preventDefault(); media.paused ? media.play() : media.pause(); }
  };
  document.addEventListener('keydown', onKey);
  show(index);
  return { close };
}
