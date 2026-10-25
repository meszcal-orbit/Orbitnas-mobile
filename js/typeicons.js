// Datei- und Ordnersymbole wie in Windows 11 – dieselben Formen und Farben wie Orbit NAS am PC (tools/symbole, EINSTELLUNGEN.md 4a).
// „Gefüllt“ = volle Farbe, „Umriss“ = Linie in der Farbe (in dunklen Designs 22 % heller, wie am PC). Einstellung iconStyle.

import { KIND_COLOR, iconPath } from './util.js';
import { SVG } from './typeicons-data.js';

const NS = 'http://www.w3.org/2000/svg';
const hex = (c, fb) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c.toUpperCase() : fb);
const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (a) => '#' + a.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
const lighter = (c, f = 0.22) => toHex(rgb(c).map((v) => v + (255 - v) * f));
const darker = (c, f = 0.78) => toHex(rgb(c).map((v) => v * f));
const isDark = () => document.documentElement.style.colorScheme !== 'light';

/**
 * Symbol als SVG.
 * kind: folder, archive, program, image, video, audio, pdf, document, sheet, slides, code, text, other
 * opts: { color (eigene Ordnerfarbe), mark (Zeichen im Ordner, z. B. 'star'), filled, cls }
 */
export function typeIcon(kind, { color = null, mark = null, filled = true, cls = '' } = {}) {
  const def = SVG[kind] || SVG.other;
  const base = kind === 'folder' ? hex(color, KIND_COLOR.folder) : KIND_COLOR[kind] || KIND_COLOR.other;
  const c = filled ? base : isDark() ? lighter(base) : base;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ic ti ' + cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = (filled ? def.f : def.o).replaceAll('{C}', c).replaceAll('{D}', darker(base));
  if (kind === 'folder' && mark && mark !== 'folder') {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', iconPath(mark));
    p.setAttribute('fill', filled ? '#fff' : c);
    p.setAttribute('transform', 'translate(7.4 9.4) scale(0.42)');
    svg.append(p);
  }
  return svg;
}
