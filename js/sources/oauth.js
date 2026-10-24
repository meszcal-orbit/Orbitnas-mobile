// Anmeldung bei Microsoft, Google und Dropbox (OAuth). Die Seite des Anbieters öffnet sich im selben Fenster;
// danach kommt man mit einem einmaligen Code zurück in die App. Passwörter sieht die App dabei nie.

import { kv } from '../db.js';
import { SourceError, offlineError } from './base.js';
import { bytesToB64url } from '../crypto.js';

export const redirectUri = () => location.origin + location.pathname;

export const OAUTH = {
  onedrive: {
    auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'Files.ReadWrite.All User.Read offline_access',
    pkce: true,
  },
  dropbox: {
    auth: 'https://www.dropbox.com/oauth2/authorize',
    token: 'https://api.dropboxapi.com/oauth2/token',
    extra: { token_access_type: 'offline' },
    pkce: true,
  },
  gdrive: {
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    scope: 'https://www.googleapis.com/auth/drive',
    implicit: true,   // Google gibt Web-Apps ohne Server keinen dauerhaften Schlüssel: Anmeldung gilt 1 Stunde
  },
};

const rand = (n) => bytesToB64url(crypto.getRandomValues(new Uint8Array(n)));
async function challenge(verifier) {
  return bytesToB64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** Leitet zur Anmeldeseite. connId: bei erneuter Anmeldung einer vorhandenen Quelle. */
export async function startLogin(type, clientId, { connId = null, hint = '' } = {}) {
  const p = OAUTH[type];
  const state = rand(16);
  const verifier = p.pkce ? rand(48) : null;
  await kv.set('oauthPending', { type, clientId, state, verifier, connId, at: Date.now(), back: location.hash });
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri(), state, ...(p.extra || {}) });
  if (p.scope) q.set('scope', p.scope);
  if (p.implicit) q.set('response_type', 'token');
  else { q.set('response_type', 'code'); q.set('code_challenge', await challenge(verifier)); q.set('code_challenge_method', 'S256'); }
  if (type === 'onedrive') q.set('response_mode', 'query');
  if (hint && type !== 'dropbox') q.set('login_hint', hint);
  if (type === 'onedrive' || type === 'gdrive') q.set('prompt', hint ? 'none' : 'select_account');
  location.href = p.auth + '?' + q;
}

export async function postForm(url, data) {
  let res;
  try { res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data) }); }
  catch { throw offlineError(); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new SourceError(j.error_description || j.error || 'Anmeldung fehlgeschlagen', { login: true, code: res.status, detail: `Token: ${res.status} ${j.error || ''}` });
  return j;
}

const tokens = (j) => ({ access: j.access_token, refresh: j.refresh_token || null, exp: Date.now() + ((j.expires_in || 3600) - 60) * 1000 });

/**
 * Beim Start aufrufen: Kommt die App gerade von einer Anmeldeseite zurück? Dann { type, clientId, connId, secret } – sonst null.
 * Bei einem Fehler: { error }.
 */
export async function handleRedirect() {
  const query = new URLSearchParams(location.search);
  const frag = new URLSearchParams(location.hash.startsWith('#access_token=') || location.hash.startsWith('#error=') || location.hash.startsWith('#state=') ? location.hash.slice(1) : '');
  const src = query.get('state') ? query : frag.get('state') ? frag : null;
  if (!src) return null;
  const pending = await kv.get('oauthPending');
  const clean = (hash) => history.replaceState(null, '', location.pathname + (hash || '#/einstellungen'));
  if (!pending || pending.state !== src.get('state')) {
    clean();
    return { error: 'Die Anmeldung kam an einer anderen Stelle an. Bitte noch einmal über die App anmelden (nicht über Safari, wenn die App auf dem Home-Bildschirm liegt).' };
  }
  await kv.del('oauthPending');
  clean(pending.back);
  if (src.get('error')) {
    const e = src.get('error');
    return { error: e === 'access_denied' ? 'Die Anmeldung wurde abgebrochen.' : e === 'interaction_required' || e === 'login_required' ? 'login_required' : (src.get('error_description') || e), type: pending.type, connId: pending.connId, clientId: pending.clientId };
  }
  const p = OAUTH[pending.type];
  let secret;
  if (p.implicit) {
    secret = { clientId: pending.clientId, ...tokens({ access_token: src.get('access_token'), expires_in: Number(src.get('expires_in')) }) };
  } else {
    const j = await postForm(p.token, {
      grant_type: 'authorization_code', code: src.get('code'), client_id: pending.clientId, redirect_uri: redirectUri(), code_verifier: pending.verifier,
      ...(p.scope ? { scope: p.scope } : {}),
    });
    secret = { clientId: pending.clientId, ...tokens(j) };
  }
  return { type: pending.type, clientId: pending.clientId, connId: pending.connId, secret };
}

/** Gemeinsamer Teil der OAuth-Quellen: gültigen Schlüssel liefern, bei Bedarf erneuern, Anfragen mit Schlüssel. */
export class OAuthBase {
  constructor(conn, secret) {
    this.conn = conn;
    this.s = secret || {};
  }
  secret() { return this.s; }

  async token() {
    if (this.s.access && Date.now() < this.s.exp) return this.s.access;
    const p = OAUTH[this.constructor.type];
    if (!this.s.refresh || !p.token) throw new SourceError('Bitte neu anmelden.', { login: true, detail: 'Anmeldung abgelaufen' });
    if (!this._refreshing) {
      this._refreshing = postForm(p.token, { grant_type: 'refresh_token', refresh_token: this.s.refresh, client_id: this.s.clientId, ...(p.scope ? { scope: p.scope } : {}) })
        .then((j) => { this.s = { ...this.s, ...tokens(j), refresh: j.refresh_token || this.s.refresh }; this.onSecret && this.onSecret(this.s); })
        .finally(() => { this._refreshing = null; });
    }
    await this._refreshing;
    return this.s.access;
  }

  /** fetch mit Schlüssel; bei 401 einmal erneuern. Liefert die Response (ok) oder wirft SourceError. */
  async req(url, opts = {}, { okStatus = [], retried = false } = {}) {
    const token = await this.token();
    let res;
    try { res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token } }); }
    catch (e) { if (e.name === 'AbortError') throw e; throw offlineError(); }
    if (res.status === 401 && !retried) { this.s.exp = 0; if (this.s.refresh) return this.req(url, opts, { okStatus, retried: true }); }
    if (res.ok || okStatus.includes(res.status)) return res;
    throw await this.error(res, url);
  }

  async json(url, opts, o) { const r = await this.req(url, opts, o); return r.status === 204 ? null : r.json().catch(() => null); }

  async error(res, url) {
    let text = '';
    try { text = await res.text(); } catch { /* leer */ }
    let j = {};
    try { j = JSON.parse(text); } catch { /* kein JSON */ }
    const msg = j.error?.message || j.error_summary || j.error_description || (typeof j.error === 'string' ? j.error : '') || text.slice(0, 120);
    const name = this.constructor.label || this.constructor.type;
    const nice = res.status === 401 ? 'Bitte neu anmelden.' : res.status === 403 ? 'Dafür fehlt die Berechtigung.' : res.status === 404 || /not_found/.test(msg) ? 'Nicht gefunden.'
      : res.status === 409 && /exist|conflict/i.test(msg) ? 'Hier gibt es schon etwas mit diesem Namen.' : res.status === 507 || /quota|insufficient_space/i.test(msg) ? 'Der Speicher ist voll.'
      : res.status >= 500 ? `${name} ist gerade nicht erreichbar.` : msg || 'Fehler';
    return new SourceError(nice, { code: res.status, login: res.status === 401, notFound: res.status === 404 || /not_found/.test(msg), detail: `${name} ${new URL(url).pathname}: ${res.status} ${msg}`.slice(0, 300) });
  }
}
