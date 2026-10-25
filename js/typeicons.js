// Datei- und Ordnersymbole wie in Windows 11 (gleiche Farben wie Orbit NAS 0.8 am PC):
// gelber Ordner mit Lasche, ZIP als Ordner mit Reißverschluss, Programme als Fenster mit Zahnrad, Dokumente als Blatt mit Kennbuchstabe.
// „Gefüllt“ = volle Farbe mit weißem Zeichen, „Umriss“ = Linie in der Farbe auf hellem Grund (Einstellung iconStyle).

import { KIND_COLOR, iconPath } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const hex = (c, fb) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : fb);

/** Etwas dunklere Farbe (für die Lasche des Ordners). */
function darker(c, f = 0.85) {
  const n = parseInt(c.slice(1), 16);
  const ch = (s) => Math.round(((n >> s) & 255) * f).toString(16).padStart(2, '0');
  return '#' + ch(16) + ch(8) + ch(0);
}

const PAGE = 'M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z';
const EAR = 'M14 2v3a2 2 0 0 0 2 2h3z';
const TAB = 'M2 6a2 2 0 0 1 2-2h5.2l2 2H20a2 2 0 0 1 2 2v2H2z';
const FRONT = 'M2 9a1 1 0 0 1 1-1h18a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z';

const LETTER = { pdf: 'PDF', document: 'W', sheet: 'X', slides: 'P', code: '</>' };

function el(name, attrs) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  return e;
}

/** Fläche: gefüllt = volle Farbe; Umriss = 15 % Farbe + Linie. */
function shape(d, color, filled, extra = {}) {
  return el('path', filled ? { d, fill: color, ...extra } : { d, fill: color, 'fill-opacity': 0.15, stroke: color, 'stroke-width': 1.3, 'stroke-linejoin': 'round', ...extra });
}

const OUTLINE = 'M2 6a2 2 0 0 1 2-2h5.2l2 2H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z';

function folderParts(svg, color, filled, inner) {
  if (filled) svg.append(shape(TAB, darker(color), true), shape(FRONT, color, true));
  else svg.append(shape(OUTLINE, color, false), el('path', { d: 'M2 9h20', stroke: color, 'stroke-width': 1.3 }));
  if (inner) svg.append(inner);
}

/**
 * Symbol als SVG.
 * kind: folder, archive, program, image, video, audio, pdf, document, sheet, slides, code, text, other
 * opts: { color (Ordnerfarbe), mark (Symbol im Ordner, z. B. 'star'), filled, cls }
 */
export function typeIcon(kind, { color = null, mark = null, filled = true, cls = '' } = {}) {
  const svg = el('svg', { viewBox: '0 0 24 24', class: 'ic ti ' + cls, 'aria-hidden': 'true' });
  const c = hex(color, KIND_COLOR[kind] || KIND_COLOR.other);
  const ink = filled ? '#fff' : c;
  if (kind === 'folder') {
    const inner = mark && mark !== 'folder' ? el('path', { d: iconPath(mark), fill: ink, transform: 'translate(7.4 9.6) scale(0.42)' }) : null;
    folderParts(svg, c, filled, inner);
  } else if (kind === 'archive') {
    folderParts(svg, c, filled);
    svg.append(el('rect', { x: 11, y: 4, width: 2, height: 16, fill: '#6B7280' }));
    for (let y = 5; y < 19; y += 2) svg.append(el('rect', { x: y % 4 === 1 ? 10.2 : 12, y, width: 1.8, height: 1, fill: '#D1D5DB' }));
    svg.append(el('rect', { x: 10, y: 13, width: 4, height: 3.2, rx: 0.6, fill: '#6B7280' }));
  } else if (kind === 'program') {
    svg.append(shape('M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', c, filled));
    svg.append(el('path', { d: 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2H3z', fill: filled ? darker(c, 0.75) : c }));
    svg.append(el('path', { d: iconPath('gear'), fill: ink, transform: 'translate(7.1 8.9) scale(0.42)' }));
  } else if (kind === 'image') {
    svg.append(shape('M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', c, filled));
    svg.append(el('circle', { cx: 8.5, cy: 9, r: 1.8, fill: ink }), el('path', { d: 'M4 18l5-6 3.5 4 2.5-3 5 5z', fill: ink }));
  } else if (kind === 'video') {
    svg.append(shape('M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', c, filled));
    for (const x of [4.6, 18.2]) for (const y of [5.6, 9.2, 12.8, 16.4]) svg.append(el('rect', { x, y, width: 1.2, height: 2, rx: 0.3, fill: ink }));
    svg.append(el('path', { d: 'M10 8.5v7l5.5-3.5z', fill: ink }));
  } else if (kind === 'audio') {
    svg.append(el('path', { d: 'M9 17.5V6.2l11-2.2v11.5', fill: 'none', stroke: c, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    svg.append(el('ellipse', { cx: 6.5, cy: 17.6, rx: 3, ry: 2.4, fill: filled ? c : 'none', stroke: c, 'stroke-width': filled ? 0 : 1.5 }));
    svg.append(el('ellipse', { cx: 17.5, cy: 15.6, rx: 3, ry: 2.4, fill: filled ? c : 'none', stroke: c, 'stroke-width': filled ? 0 : 1.5 }));
  } else {
    svg.append(shape(PAGE, c, filled), el('path', { d: EAR, fill: filled ? '#fff' : c, 'fill-opacity': filled ? 0.45 : 0.5 }));
    const t = LETTER[kind];
    if (t) {
      const txt = el('text', { x: 11.5, y: t.length > 1 ? 17 : 18, 'text-anchor': 'middle', 'font-family': '-apple-system, system-ui, sans-serif', 'font-weight': 800, 'font-size': t.length > 2 ? 5.6 : t.length > 1 ? 6.2 : 9, fill: ink });
      txt.textContent = t;
      svg.append(txt);
    } else if (kind === 'text') {
      for (const [y, w] of [[11, 9], [13.8, 9], [16.6, 6]]) svg.append(el('rect', { x: 7, y, width: w, height: 1.3, rx: 0.6, fill: ink }));
    }
  }
  return svg;
}
