// Seite „Protokoll“ wie am PC: alles, was Orbit NAS tut. Kommt verschlüsselt vom PC (protokoll.onm).

import { h, icon, norm, debounce, fmtAgo, clear } from './util.js';
import { state, sync } from './sync.js';

let onlyProblems = false;
let query = '';

const LEVEL = { Info: 'muted', Warnung: 'warn', Fehler: 'danger' };
const fmt = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(',', '');
};

export function renderLog(view) {
  const lines = h('div.loglines');
  const search = h('input.input.logsearch', { type: 'search', placeholder: 'Suchen', value: query, oninput: debounce((e) => { query = e.target.value; paint(); }, 150) });
  const only = h('label.check', h('input', { type: 'checkbox', checked: onlyProblems, onchange: (e) => { onlyProblems = e.target.checked; paint(); } }), h('span', 'Nur Fehler und Warnungen'));
  const foot = h('p.muted.small');
  clear(view).append(h('div.page.log',
    h('div.page-head', h('div', h('h1', 'Protokoll'), h('p.sub', 'Alles, was Orbit NAS tut – jede Erlaubnis, jede Übertragung, jeder Fehler.')),
      h('div.head-actions', only, search, h('button.btn', { title: 'Aktualisieren', onclick: async () => { try { await sync({ force: true }); } catch { /* angezeigt */ } paint(); } }, icon('sync')))),
    h('div.card.logcard', lines), foot));

  function paint() {
    const all = state.log?.lines || [];
    const q = norm(query.trim());
    const list = all.filter((l) => (!onlyProblems || l[1] !== 'Info') && (!q || norm(l[2] + ' ' + l[3]).includes(q)));
    clear(lines);
    if (!state.log) lines.append(h('div.empty', icon('log', 'big'), h('p', 'Vom PC ist noch kein Protokoll da (ab Orbit NAS 0.5.2).')));
    else if (!list.length) lines.append(h('div.empty.small', 'Keine Einträge.'));
    // neueste oben, wie man es am Handy erwartet
    for (const l of list.slice().reverse()) {
      lines.append(h('div.logline', h('span.lt', fmt(l[0])), h('span.ll', h('span.dot.' + (LEVEL[l[1]] || 'muted')), h('b', l[2])), h('span.lx' + (l[1] === 'Fehler' ? '.danger' : ''), l[3])));
    }
    foot.textContent = state.log ? `${all.length} Einträge vom PC, Stand ${fmtAgo(state.log.generated)}.` : '';
  }
  paint();
}
