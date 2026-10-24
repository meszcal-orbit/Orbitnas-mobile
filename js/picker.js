// Zielordner wählen (für Verschieben, Kopieren, Hochladen) – wie die Ordnerauswahl in der App „Dateien“.

import { h, icon, sheet, clear, promptDialog, toast, fmtSize } from './util.js';
import { connections } from './sources/registry.js';
import { listFolder, visible, glyph, writable, connName, srcColor, newFolder, errText, lockFor, isUnlocked } from './fileops.js';
import { joinPath, parentPath, baseName } from './sources/base.js';

/** Datei wählen (für „Auf der FRITZ!NAS speichern“). Liefert den Eintrag oder null. */
export const pickFile = (title) => pickFolder(title, { files: true });

/** Liefert { conn, path } oder null. title: z. B. „Verschieben nach“. Mit files: true werden Dateien gezeigt und eine davon geliefert. */
export function pickFolder(title, { start = null, ok = 'Hierher', files = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let at = start; // null = Übersicht der Quellen
    const head = h('div.pk-head');
    const list = h('div.pk-list');
    const okBtn = h('button.btn.primary.block', { onclick: () => { if (!at) return; done = true; s.close(); resolve(at); } }, ok);
    const mk = h('button.btn.block', { onclick: async () => {
      const name = await promptDialog('', 'Neuer Ordner', { title: 'Neuer Ordner', ok: 'Anlegen', select: (v) => v.length });
      if (!name) return;
      try { await newFolder(at.conn, at.path, name); at = { conn: at.conn, path: joinPath(at.path, name) }; paint(); } catch (e) { toast(errText(e), 'err'); }
    } }, icon('plusFolder'), ' Neuer Ordner');
    const s = sheet(h('div.picker', head, list, files ? null : h('div.pk-foot', mk, okBtn)), { title, onClose: () => { if (!done) resolve(null); } });

    async function paint() {
      clear(head);
      clear(list);
      if (!at) {
        okBtn.disabled = true; mk.disabled = true;
        head.append(h('div.pk-where', 'Ort wählen'));
        for (const c of connections()) {
          list.append(h('button.pk-row', { onclick: () => { at = { conn: c.id, path: '/' }; paint(); } },
            h('span.srcicon', { style: { background: srcColor(c.id) } }, icon('cloud')), h('span.pk-name', c.name), icon('chevron', 'chev')));
        }
        return;
      }
      okBtn.disabled = !writable(at.conn, at.path);
      mk.disabled = okBtn.disabled;
      head.append(h('button.pk-back', { onclick: () => { at = at.path === '/' ? null : { conn: at.conn, path: parentPath(at.path) }; paint(); } }, icon('back'), at.path === '/' ? 'Orte' : baseName(parentPath(at.path)) || connName(at.conn)),
        h('div.pk-where', at.path === '/' ? connName(at.conn) : baseName(at.path)));
      list.append(h('div.loading', h('div.spinner'), 'Lädt …'));
      const lk = lockFor(at.conn, at.path);
      if (lk && !isUnlocked(at.conn, lk)) { clear(list).append(h('p.muted.pad', 'Geschützt – bitte zuerst im Datei-Manager entsperren.')); okBtn.disabled = true; return; }
      try {
        const items = visible(at.conn, await listFolder(at.conn, at.path)).filter((x) => files || x.isFolder).sort((a, b) => (b.isFolder - a.isFolder) || a.name.localeCompare(b.name, 'de', { numeric: true }));
        clear(list);
        if (!items.length) list.append(h('p.muted.pad', files ? 'Leer.' : 'Keine Unterordner.'));
        for (const it of items) {
          list.append(h('button.pk-row', { onclick: () => {
            if (it.isFolder) { at = { conn: at.conn, path: it.path }; paint(); return; }
            done = true; s.close(); resolve(it);
          } }, glyph(it), h('span.pk-name', it.name), it.isFolder ? icon('chevron', 'chev') : h('small.muted', fmtSize(it.size))));
        }
      } catch (e) { clear(list).append(h('p.err-text.pad', errText(e))); }
    }
    paint();
  });
}
