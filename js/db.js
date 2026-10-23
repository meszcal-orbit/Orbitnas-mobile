// Lokaler Speicher der App (IndexedDB). Updates der App ändern hier nie etwas:
// Neue Versionen dürfen nur Bereiche HINZUFÜGEN (siehe MIGRATIONS), nie löschen oder umbauen.

const DB_NAME = 'orbitnas';
const MIGRATIONS = [
  // 1: Grundausstattung
  (db) => {
    db.createObjectStore('kv');      // Einstellungen, Kopplung, Register
    db.createObjectStore('cache');   // zwischengespeicherte Ordnerlisten, Übersichten (darf neu geladen werden)
  },
];

let dbPromise;
function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, MIGRATIONS.length);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        for (let v = e.oldVersion; v < MIGRATIONS.length; v++) MIGRATIONS[v](db, req.transaction);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); location.reload(); };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Bitte die App in anderen Fenstern schließen.'));
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const st = tx.objectStore(store);
    let result;
    const r = fn(st);
    if (r) r.onsuccess = () => { result = r.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Speichern abgebrochen'));
  });
}

export const kv = {
  get: (k) => run('kv', 'readonly', (s) => s.get(k)),
  set: (k, v) => run('kv', 'readwrite', (s) => s.put(v, k)),
  del: (k) => run('kv', 'readwrite', (s) => s.delete(k)),
  keys: () => run('kv', 'readonly', (s) => s.getAllKeys()),
};

export const cache = {
  get: (k) => run('cache', 'readonly', (s) => s.get(k)),
  set: (k, v) => run('cache', 'readwrite', (s) => s.put(v, k)),
  del: (k) => run('cache', 'readwrite', (s) => s.delete(k)),
  clear: () => run('cache', 'readwrite', (s) => s.clear()),
};

/** Bittet iOS, die Daten dauerhaft zu behalten (nicht bei Speichermangel löschen). */
export async function persist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* nicht unterstützt */ }
  return false;
}

export async function usage() {
  try { return await navigator.storage.estimate(); } catch { return null; }
}
