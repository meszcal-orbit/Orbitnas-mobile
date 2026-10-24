// Vorgangsleiste wie am PC: alles, was gerade läuft (Hochladen, Kopieren, Verschieben, Löschen), in einer festen,
// schmalen Leiste über der Tab-Leiste. Sie verschiebt nichts; antippen klappt die Einzelheiten auf.

import { h, icon, sheet, clear, fmtSize } from './util.js';
import { onQueue, stats, queue, cancel, retry, clearFinished } from './upload.js';

let bar = null;
let openSheet = null;
const ops = new Set();

/** Einen Vorgang anzeigen. Rückgabe: { update(prozent, schritt), done() } */
export function startOp(title) {
  const op = { title, pct: null, step: '' };
  ops.add(op);
  paint();
  return {
    update: (pct, step) => { op.pct = pct; if (step) op.step = step; paint(); },
    done: () => { ops.delete(op); paint(); },
  };
}

function summary() {
  const up = stats();
  let n = ops.size, sum = 0, cnt = 0;
  const parts = [];
  if (up.active) { n += up.active; sum += up.bytes ? (up.loaded / up.bytes) * 100 : 0; cnt++; parts.push(`Hochladen ${up.done + up.skipped}/${up.total}`); }
  for (const o of ops) { if (o.pct != null) { sum += o.pct; cnt++; } }
  if (ops.size) parts.push(ops.size === 1 ? [...ops][0].title : `${ops.size} Vorgänge`);
  if (!n) return null;
  return { n, pct: cnt ? Math.round(sum / cnt) : null, text: parts.join(' · ') };
}

export function mountOpsBar(root) {
  bar = h('button.opsbar', { onclick: details, 'aria-label': 'Vorgänge anzeigen', hidden: true });
  root.append(bar);
  paint();
}

function paint() {
  if (openSheet) openSheet();
  if (!bar || !document.body.contains(bar)) return;
  const s = summary();
  document.documentElement.classList.toggle('has-ops', !!s);
  if (!s) { clear(bar); bar.hidden = true; return; }
  bar.hidden = false;
  clear(bar).append(
    h('span.ob-text', h('b', s.text), s.pct != null ? h('span.muted', ` · ${s.pct} %`) : null),
    icon('up'),
    h('div.ob-meter', h('div.fill', { style: { width: (s.pct ?? 0) + '%' } })));
}

export function details() {
  const body = h('div.dialog-body.obdetails');
  sheet(body, { title: 'Vorgänge', onClose: () => { openSheet = null; } });
  const paintD = () => {
    clear(body);
    for (const o of ops) {
      body.append(h('div.card.op', h('div.op-top', h('b', o.title), h('div.spinner.small')),
        o.step ? h('div.muted.small', o.step) : null,
        o.pct != null ? h('div.meter', h('div.fill', { style: { width: o.pct + '%' } })) : null));
    }
    const up = stats();
    if (up.total) {
      const pct = up.bytes ? Math.round((up.loaded / up.bytes) * 100) : 100;
      body.append(h('div.card.op',
        h('div.op-top', h('b', 'Hochladen'), h('span.muted.small', `${up.done} fertig · ${up.skipped} übersprungen${up.failed ? ` · ${up.failed} Fehler` : ''}${up.active ? ` · ${up.active} offen` : ''}`)),
        h('div.meter', h('div.fill', { style: { width: pct + '%' } })),
        h('div.uplist', [...queue].reverse().map((q) => {
          const p = q.total ? Math.round((q.loaded / q.total) * 100) : 0;
          const tone = { fertig: 'ok', übersprungen: 'muted', fehler: 'danger', läuft: 'accent', pausiert: 'warn' }[q.status] || 'muted';
          return h('div.uprow',
            h('div.upname', h('b', q.finalName || q.name), h('small', h('span.dot.' + tone), ` ${q.status === 'läuft' ? p + ' %' : q.status} · ${fmtSize(q.total)} → ${q.label}${q.message ? ' · ' + q.message : ''}`)),
            q.status === 'übersprungen' ? h('button.btn.small', { onclick: () => retry(q, true) }, 'Trotzdem') : null,
            q.status === 'fehler' && q.message !== 'Abgebrochen' ? h('button.btn.small', { onclick: () => retry(q) }, 'Nochmal') : null,
            ['wartet', 'läuft', 'pausiert', 'prüfe'].includes(q.status) ? h('button.icon-btn', { 'aria-label': 'Abbrechen', onclick: () => cancel(q) }, icon('close')) : null);
        })),
        !up.active ? h('button.link', { onclick: clearFinished }, 'Liste leeren') : null,
        h('p.muted.small', 'Schon hochgeladene Fotos und Videos werden erkannt und übersprungen. Bitte die App beim Hochladen geöffnet lassen; nach einer Unterbrechung geht es von selbst weiter.')));
    }
    if (!ops.size && !up.total) body.append(h('p.muted', 'Gerade läuft nichts.'));
  };
  openSheet = paintD;
  paintD();
}

onQueue(paint);
