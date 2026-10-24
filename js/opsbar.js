// Vorgangsleiste wie am PC (0.6.1): alle laufenden Dinge (Hochladen, Vorgänge am PC, Aufträge) in einer festen,
// schmalen Leiste unten. Sie verschiebt nichts; antippen klappt die Einzelheiten auf.

import { h, icon, sheet, clear } from './util.js';
import { state, onChange, openJobs } from './sync.js';
import { onQueue, stats, queue } from './upload.js';

let bar = null;
let openSheet = null;

const pcOps = () => (state.status?.operations || []).filter((o) => o.status === 'Läuft' || o.status === 'Wartet' || o.status === 'Pausiert');
const jobs = () => openJobs().filter((j) => j.type !== 'liste');

function summary() {
  const up = stats();
  const ops = pcOps();
  const js = jobs();
  const parts = [];
  let n = 0, sum = 0, cnt = 0;
  if (up.active) { n += up.active; sum += up.bytes ? (up.loaded / up.bytes) * 100 : 0; cnt++; }
  for (const o of ops) { n++; if (o.percent != null) { sum += o.percent; cnt++; } }
  n += js.length;
  if (!n) return null;
  if (up.active) parts.push(`Hochladen ${up.done + up.skipped}/${up.total}`);
  if (ops.length) parts.push(ops.length === 1 ? ops[0].title : `${ops.length} am PC`);
  if (js.length) parts.push(js.length === 1 ? '1 Auftrag' : `${js.length} Aufträge`);
  return { n, pct: cnt ? Math.round(sum / cnt) : null, text: parts.join(' · ') };
}

export function mountOpsBar(root) {
  bar = h('button.opsbar', { onclick: details, 'aria-label': 'Vorgänge anzeigen' });
  root.append(bar);
  paint();
}

function paint() {
  if (!bar || !document.body.contains(bar)) return;
  const s = summary();
  document.documentElement.classList.toggle('has-ops', !!s);
  if (!s) { clear(bar); bar.hidden = true; return; }
  bar.hidden = false;
  clear(bar).append(
    h('span.ob-text', h('b', `${s.n} ${s.n === 1 ? 'Vorgang' : 'Vorgänge'}`), s.pct != null ? ` · ${s.pct} %` : '', h('span.muted', ' · ' + s.text)),
    icon('up'),
    h('div.ob-meter', h('div.fill', { style: { width: (s.pct ?? 0) + '%' } })));
  if (openSheet) openSheet.paint();
}

function details() {
  const body = h('div.dialog-body.obdetails');
  const s = sheet(body, { title: 'Vorgänge', onClose: () => { openSheet = null; } });
  const paintD = () => {
    const up = stats();
    const ops = pcOps();
    const js = jobs();
    clear(body);
    if (up.total) {
      const pct = up.bytes ? Math.round((up.loaded / up.bytes) * 100) : 100;
      body.append(h('div.card.op',
        h('div.op-top', h('b', 'Hochladen vom Handy'), h('span.pill.' + (up.active ? 'accent' : 'ok'), up.active ? 'Läuft' : 'Fertig')),
        h('div.meter', h('div.fill', { style: { width: pct + '%' } })),
        h('div.op-meta.muted.small', `${up.done} fertig · ${up.skipped} übersprungen${up.failed ? ` · ${up.failed} Fehler` : ''}${up.active ? ` · ${up.active} offen` : ''} · ${pct} %`),
        h('button.btn.small', { onclick: async () => { s.close(); (await import('./files.js')).transfersSheet(); } }, 'Einzelne Dateien und Abbrechen …')));
    }
    for (const o of ops) {
      body.append(h('div.card.op',
        h('div.op-top', h('b', o.title), h('span.pill.accent', o.status), o.fromPhone ? h('span.muted.small', 'vom Handy') : null),
        o.step ? h('div.muted', o.step) : null,
        o.percent != null ? h('div.meter', h('div.fill', { style: { width: Math.round(o.percent) + '%' } })) : null,
        h('div.op-meta.muted.small', [o.percent != null ? Math.round(o.percent) + ' %' : '', o.bytesText, o.speedText, o.etaText].filter(Boolean).join(' · ')),
        o.currentFile ? h('div.muted.small.ellipsis', o.currentFile) : null));
    }
    for (const j of js) {
      body.append(h('div.card.op',
        h('div.op-top', h('b', j.label), h('span.pill.' + (j.state === 'laeuft' ? 'accent' : 'muted'), j.state === 'laeuft' ? 'Läuft' : 'Wartet auf den PC')),
        j.message && !/^Wartet/.test(j.message) ? h('div.muted.small', j.message) : null));
    }
    if (!up.total && !ops.length && !js.length) body.append(h('p.muted', 'Gerade läuft nichts.'));
    if (ops.length) body.append(h('p.muted.small', 'Vorgänge am PC hältst du am PC an (unten in der Vorgangsleiste).'));
  };
  openSheet = { paint: paintD };
  paintD();
}

onQueue(paint);
onChange((w) => { if (w === 'status' || w === 'jobs' || w === 'sync') paint(); });
export { queue };
