// „Cloud hinzufügen“: nur Anbieter, die im Browser wirklich gehen. Die Anmeldung passiert erst hier,
// mit einer Schritt-für-Schritt-Anleitung im Fenster.

import { h, icon, sheet, toast, clear } from './util.js';
import { kv } from './db.js';
import { addConnection, updateSecret, connById, PROVIDERS } from './sources/registry.js';
import { startLogin, redirectUri } from './sources/oauth.js';
import { loadSecret } from './secrets.js';
import { go, dirHash } from './ui.js';
import { errText } from './fileops.js';
import { openFritz } from './fritz.js';

const step = (n, ...content) => h('li.step', h('span.stepnum', String(n)), h('div.stepbody', ...content));
const ext = (href, text) => h('a.extlink', { href, target: '_blank', rel: 'noopener' }, text, ' ', icon('path'));
const copyBox = (text) => h('div.copybox', h('code', text), h('button.btn.small', { onclick: async () => { try { await navigator.clipboard.writeText(text); toast('Kopiert'); } catch { toast(text); } } }, icon('copy'), ' Kopieren'));

export function openAddCloud() {
  const list = h('div.actions');
  const s = sheet(h('div', h('p.muted.small.pad', 'Hier stehen nur Anbieter, die in der App direkt funktionieren. Angemeldet wird erst, wenn du einen auswählst.'), list), { title: 'Cloud hinzufügen' });
  const item = (type, sub, onclick, ic = 'cloud') => h('button.action', { onclick: () => { s.close(); onclick(); } },
    h('span.srcicon.small', { style: { background: PROVIDERS[type]?.color || '#E2001A' } }, icon(ic)), h('span', PROVIDERS[type]?.name || type, h('small', sub)));
  list.append(
    item('pcloud', 'Mit E-Mail und Passwort', () => pcloudForm()),
    item('onedrive', 'Microsoft-Konto · einmalig eine App-Kennung anlegen', () => oauthGuide('onedrive')),
    item('gdrive', 'Google-Konto · einmalig eine App-Kennung anlegen', () => oauthGuide('gdrive')),
    item('dropbox', 'Dropbox-Konto · einmalig eine App-Kennung anlegen', () => oauthGuide('dropbox')),
    item('FRITZ!NAS', 'Über die App „Dateien“ (im Heimnetz)', () => openFritz(), 'disk'),
    h('div.action-sep'),
    item('demo', 'Ohne Anmeldung ausprobieren', async () => { const c = await addConnection('demo', {}, {}); go(dirHash(c.id)); }, 'layers'),
    h('p.muted.small.pad', 'iCloud Drive gibt es für Web-Apps nicht. Dateien aus iCloud Drive wählst du beim Hochladen über „Dateien“ aus.'));
}

// ---------------------------------------------------------------- pCloud

export function pcloudForm({ connId = null, email = '' } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    const user = h('input.input', { type: 'email', placeholder: 'E-Mail-Adresse', value: email, autocomplete: 'username', autocapitalize: 'off', autocorrect: 'off', spellcheck: false });
    const pass = h('input.input', { type: 'password', placeholder: 'pCloud-Passwort', autocomplete: 'current-password' });
    const msg = h('div.formmsg');
    const btn = h('button.btn.primary.block', { type: 'submit' }, 'Anmelden');
    const submit = async (e) => {
      e.preventDefault();
      if (!user.value.trim() || !pass.value) { msg.className = 'formmsg err-text'; msg.textContent = 'Bitte E-Mail und Passwort eingeben.'; return; }
      btn.disabled = true;
      msg.className = 'formmsg muted';
      msg.textContent = 'Melde an …';
      try {
        const secret = { user: user.value.trim(), pass: pass.value };
        let conn;
        if (connId) { await updateSecret(connId, secret); conn = connById(connId); } else conn = await addConnection('pcloud', { host: 'api.pcloud.com' }, secret);
        ok = true;
        s.close();
        toast('pCloud ist verbunden');
        resolve(conn);
        if (!connId) go(dirHash(conn.id));
      } catch (er) {
        btn.disabled = false;
        msg.className = 'formmsg err-text';
        clear(msg).append(h('b', er.message), er.detail ? h('small.detail', er.detail) : null);
      }
    };
    const s = sheet(h('form.dialog-body.guide', { onsubmit: submit },
      h('ol.steps',
        step(1, h('b', 'Konto'), h('p.muted.small', 'Noch keins? '), ext('https://www.pcloud.com/de/', 'Kostenlos bei pCloud registrieren')),
        step(2, h('b', 'E-Mail und Passwort von pCloud eingeben'), user, pass),
        step(3, h('b', 'Anmelden'), h('p.muted.small', 'Das Passwort bleibt nur auf diesem Gerät, verschlüsselt. Es kommt nie in die Einstellungsdatei und nicht zum PC.'))),
      msg, btn,
      h('p.muted.small', 'Hast du bei pCloud die Zwei-Faktor-Anmeldung eingeschaltet, geht es im Moment noch nicht – dann bitte Bescheid geben.')),
    { title: connId ? 'Bei pCloud neu anmelden' : 'pCloud hinzufügen', onClose: () => { if (!ok) resolve(null); } });
    setTimeout(() => (email ? pass : user).focus(), 300);
  });
}

// ---------------------------------------------------------------- OneDrive, Google Drive, Dropbox

const GUIDES = {
  onedrive: {
    title: 'OneDrive hinzufügen',
    intro: 'Microsoft verlangt, dass jede App eine eigene Kennung hat. Die legst du einmal kostenlos an (am besten am PC, dauert etwa 5 Minuten). Danach meldest du dich ganz normal bei Microsoft an.',
    steps: (uri) => [
      [h('b', 'Microsoft-Seite für App-Kennungen öffnen'), ext('https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade', 'portal.azure.com → App-Registrierungen'), h('p.muted.small', 'Mit dem Microsoft-Konto anmelden, mit dem du OneDrive nutzt.')],
      [h('b', '„+ Neue Registrierung“'), h('p.muted.small', 'Name: Orbit NAS. Unterstützte Kontotypen: „Konten in einem beliebigen Organisationsverzeichnis und persönliche Microsoft-Konten“.')],
      [h('b', 'Umleitungs-URI eintragen'), h('p.muted.small', 'Plattform: „Single-Page-Anwendung (SPA)“, Adresse genau so:'), copyBox(uri)],
      [h('b', '„Registrieren“ antippen'), h('p.muted.small', 'Auf der nächsten Seite steht „Anwendungs-ID (Client)“. Diese kopieren und unten einfügen.')],
    ],
    label: 'Anwendungs-ID (Client)',
  },
  gdrive: {
    title: 'Google Drive hinzufügen',
    intro: 'Google verlangt, dass jede App eine eigene Kennung hat. Die legst du einmal kostenlos an (am besten am PC, dauert etwa 10 Minuten). Hinweis: Google lässt Web-Apps nur für 1 Stunde angemeldet – danach genügt ein Tippen auf „Neu anmelden“.',
    steps: (uri) => [
      [h('b', 'Google Cloud öffnen und ein Projekt anlegen'), ext('https://console.cloud.google.com/projectcreate', 'console.cloud.google.com'), h('p.muted.small', 'Projektname: Orbit NAS → Erstellen.')],
      [h('b', 'Google Drive API einschalten'), ext('https://console.cloud.google.com/apis/library/drive.googleapis.com', 'Google Drive API → Aktivieren')],
      [h('b', 'Zustimmungsbildschirm einrichten'), ext('https://console.cloud.google.com/auth/overview', 'Google Auth Platform'), h('p.muted.small', 'App-Name: Orbit NAS, deine E-Mail, Zielgruppe „Extern“. Unter „Zielgruppe“ bei Testnutzer deine Gmail-Adresse hinzufügen.')],
      [h('b', 'Client anlegen'), ext('https://console.cloud.google.com/auth/clients/create', 'Clients → Client erstellen'), h('p.muted.small', 'Anwendungstyp „Webanwendung“. Bei „Autorisierte JavaScript-Quellen“:'), copyBox(location.origin), h('p.muted.small', 'Bei „Autorisierte Weiterleitungs-URIs“:'), copyBox(uri)],
      [h('b', '„Erstellen“ antippen'), h('p.muted.small', 'Die angezeigte „Client-ID“ (endet auf .apps.googleusercontent.com) kopieren und unten einfügen.')],
    ],
    label: 'Client-ID',
  },
  dropbox: {
    title: 'Dropbox hinzufügen',
    intro: 'Dropbox verlangt, dass jede App eine eigene Kennung hat. Die legst du einmal kostenlos an (am besten am PC, dauert etwa 5 Minuten). Danach meldest du dich ganz normal bei Dropbox an.',
    steps: (uri) => [
      [h('b', 'Dropbox-Entwicklerseite öffnen'), ext('https://www.dropbox.com/developers/apps/create', 'dropbox.com/developers → Create app')],
      [h('b', 'App anlegen'), h('p.muted.small', '„Scoped access“ → „Full Dropbox“ → Name z. B. „OrbitNAS-Dennis“ → Create app.')],
      [h('b', 'Rechte setzen (Reiter „Permissions“)'), h('p.muted.small', 'Haken bei files.metadata.write, files.content.write, files.content.read, sharing.write und account_info.read → unten „Submit“.')],
      [h('b', 'Adresse eintragen (Reiter „Settings“)'), h('p.muted.small', 'Bei „OAuth 2 → Redirect URIs“ diese Adresse hinzufügen („Add“). „Allow public clients“ muss auf „Allow“ stehen.'), copyBox(uri)],
      [h('b', '„App key“ kopieren'), h('p.muted.small', 'Er steht oben im Reiter „Settings“. Unten einfügen.')],
    ],
    label: 'App key',
  },
};

export async function oauthGuide(type, { connId = null } = {}) {
  const g = GUIDES[type];
  const known = ((await kv.get('clientIds')) || {})[type] || '';
  const input = h('input.input', { placeholder: g.label, value: known, autocapitalize: 'off', autocorrect: 'off', spellcheck: false });
  const msg = h('div.formmsg');
  const submit = async (e) => {
    e.preventDefault();
    const id = input.value.trim();
    if (id.length < 8) { msg.className = 'formmsg err-text'; msg.textContent = `Bitte die ${g.label} einfügen.`; return; }
    const ids = (await kv.get('clientIds')) || {};
    ids[type] = id;
    await kv.set('clientIds', ids);
    msg.className = 'formmsg muted';
    msg.textContent = 'Weiter zu ' + PROVIDERS[type].name + ' …';
    await startLogin(type, id, { connId });
  };
  const steps = g.steps(redirectUri());
  sheet(h('form.dialog-body.guide', { onsubmit: submit },
    h('p.muted.small', g.intro),
    known ? h('p.ok-text.small', 'Die Kennung ist schon gespeichert – du kannst gleich unten auf „Weiter“ tippen.') : null,
    h('ol.steps', ...steps.map((c, i) => step(i + 1, ...c)),
      step(steps.length + 1, h('b', 'Kennung einfügen und anmelden'), input, h('p.muted.small', 'Danach öffnet sich die Anmeldeseite von ' + PROVIDERS[type].name + '. Dort anmelden und „Zustimmen“. Dann kommst du automatisch hierher zurück.'))),
    msg, h('button.btn.primary.block', { type: 'submit' }, 'Weiter zur Anmeldung')),
  { title: g.title, wide: true });
}

/** Erneut anmelden (Passwort geändert, Anmeldung abgelaufen). */
export async function relogin(connId) {
  const c = connById(connId);
  if (!c) return;
  if (c.type === 'pcloud') { const s = await loadSecret(connId); return pcloudForm({ connId, email: s?.user || c.email || '' }); }
  if (c.type === 'demo') return;
  const s = await loadSecret(connId);
  const clientId = s?.clientId || ((await kv.get('clientIds')) || {})[c.type];
  if (!clientId) return oauthGuide(c.type, { connId });
  await startLogin(c.type, clientId, { connId, hint: c.type === 'gdrive' ? c.email : '' });
}

/** Nach der Rückkehr von der Anmeldeseite (aus app.js). */
export async function finishOAuth(r) {
  if (r.error === 'login_required' && r.type) { await startLogin(r.type, r.clientId, { connId: r.connId }); return; }
  if (r.error) { toast(r.error, 'err'); return; }
  try {
    if (r.connId && connById(r.connId)) { await updateSecret(r.connId, r.secret); toast(PROVIDERS[r.type].name + ': wieder angemeldet'); }
    else { const c = await addConnection(r.type, { clientId: r.clientId }, r.secret); toast(PROVIDERS[r.type].name + ' ist verbunden'); go(dirHash(c.id), { replace: true }); }
  } catch (e) { toast(errText(e), 'err'); }
}
