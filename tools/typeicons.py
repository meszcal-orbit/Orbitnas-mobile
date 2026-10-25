#!/usr/bin/env python3
"""Baut js/typeicons-data.js aus den Symbolen des PC-Programms (tools/symbole/<art>-gefuellt.svg / -umriss.svg).
Umriss: die 22 % hellere Farbe wird zu {C} (dunkle Designs hell, helle Designs Originalfarbe).
Ordner gefüllt: Farbe {C}, Lasche {D} (für eigene Ordnerfarben)."""
import json, re, pathlib
ROOT = pathlib.Path(__file__).resolve().parent
KINDS = {'folder': '#F5B544', 'archive': '#F5B544', 'program': '#3B82F6', 'image': '#EC4899', 'video': '#A855F7', 'audio': '#F97316',
         'pdf': '#EF4444', 'document': '#2B579A', 'sheet': '#217346', 'slides': '#D24726', 'code': '#14B8A6', 'text': '#9CA3AF', 'other': '#9CA3AF'}
def rgb(h): return [int(h[i:i + 2], 16) for i in (1, 3, 5)]
def hx(c): return '#' + ''.join('%02X' % round(v) for v in c)
def lighter(h, f=0.22): return hx([v + (255 - v) * f for v in rgb(h)])
def darker(h, f=0.78): return hx([v * f for v in rgb(h)])
def inner(svg): return re.sub(r'^<svg[^>]*>|</svg>\s*$', '', svg.strip())
out = {}
for k, base in KINDS.items():
    f = inner((ROOT / 'symbole' / f'{k}-gefuellt.svg').read_text())
    o = inner((ROOT / 'symbole' / f'{k}-umriss.svg').read_text())
    o = re.sub(re.escape(lighter(base)), '{C}', o, flags=re.I)
    if k == 'folder':
        f = re.sub(re.escape(base), '{C}', f, flags=re.I)
        f = re.sub(re.escape(darker(base)), '{D}', f, flags=re.I)
    assert '{C}' in o, k
    out[k] = {'f': f, 'o': o}
(ROOT.parent / 'js' / 'typeicons-data.js').write_text('// Erzeugt von tools/typeicons.py aus den Symbolen des PC-Programms – nicht von Hand ändern.\nexport const SVG = ' + json.dumps(out, ensure_ascii=False, indent=1) + ';\n')
print('ok', len(out))
