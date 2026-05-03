// Tiny fetch wrapper for the customer portal. Auth is cookie-based, so
// `credentials: 'include'` is mandatory; CSRF token is read from /me and
// echoed on every unsafe method.
const API_BASE = (typeof window !== 'undefined' && window.AXAL_API_BASE) || '';

let csrfToken = '';
export function setCsrf(t) { csrfToken = t || ''; }
export function getCsrf() { return csrfToken; }
export function apiBase() { return API_BASE; }

async function parse(res) {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

export async function api(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !(opts.body instanceof FormData) && typeof opts.body !== 'string') {
    headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  if (method !== 'GET' && method !== 'HEAD' && csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    method,
    headers,
    credentials: 'include',
  });
  if (res.status === 401) {
    const err = new Error('Not signed in');
    err.code = 'unauthorized';
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const body = await parse(res).catch(() => null);
    const msg = (body && body.error && body.error.message) || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return parse(res);
}

export async function fetchMe() {
  const r = await api('/api/auth/me');
  setCsrf(r.data?.csrfToken);
  return r.data?.customer || null;
}

export async function requestMagicLink(email, redirectTo, turnstileToken) {
  // The /auth/magic-link endpoint is gated by the Turnstile middleware. We
  // forward the token via header *and* in the JSON body so either intake path
  // in the worker resolves it. Worker dev mode (no key configured) skips
  // verification entirely, which is fine for local runs.
  const headers = {};
  if (turnstileToken) headers['cf-turnstile-token'] = turnstileToken;
  return api('/api/auth/magic-link', {
    method: 'POST',
    body: {
      email,
      redirectTo: redirectTo || '/account/',
      turnstileToken: turnstileToken || undefined,
    },
    headers,
  });
}

export async function logout() {
  return api('/api/auth/logout', { method: 'POST' });
}

// Convenience downloaders -----------------------------------------------------

export function exportDataUrl() { return `${API_BASE}/api/account/export`; }

/** POSTs the export request (so it's CSRF-protected and audit-logged) and
 *  triggers a browser download by streaming the JSON blob through a hidden
 *  anchor. Returns the filename for UI feedback. */
export async function downloadExport() {
  const res = await fetch(`${API_BASE}/api/account/export`, {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken },
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Export failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `axal-data-export.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'axal-data-export.json';
}
