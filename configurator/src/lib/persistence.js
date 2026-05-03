// Save / share helpers. Stubs the backend Worker until phase 8 ships.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export function generateId(prefix = 'cfg_') {
  let s = '';
  const arr = new Uint8Array(8);
  (globalThis.crypto || window.crypto).getRandomValues(arr);
  for (let i = 0; i < arr.length; i++) s += ALPHABET[arr[i] % ALPHABET.length];
  return prefix + s;
}

const LS_KEY = 'axal:configs';
const LS_OWNER_KEY = 'axal:ownerToken';

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch (e) {
    return {};
  }
}
function writeStore(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) { /* quota */ }
}

// Stable per-browser owner token. Anyone with the same token is treated as
// the original author of a saved config and gets edit access; everyone else
// gets a read-only view until they click "Claim & edit".
export function getOwnerToken() {
  try {
    let t = localStorage.getItem(LS_OWNER_KEY);
    if (!t) {
      t = generateId('owner_');
      localStorage.setItem(LS_OWNER_KEY, t);
    }
    return t;
  } catch (e) {
    return 'owner_anonymous';
  }
}

export async function saveConfig(config, existingId) {
  const id = existingId || generateId();
  const ownerToken = getOwnerToken();
  const payload = { id, savedAt: new Date().toISOString(), ownerToken, config };
  // Local store
  const store = readStore();
  store[id] = payload;
  writeStore(store);
  // Stub remote POST. Best-effort, never blocks UX.
  try {
    if (typeof fetch !== 'undefined') {
      // Fire-and-forget; real endpoint ships in worker phase
      fetch('/api/configs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => {});
    }
  } catch (e) {}
  return id;
}

// Returns the saved record (with ownerToken) so callers can decide if it
// is editable. null when no record exists locally.
export function loadConfigRecord(id) {
  const store = readStore();
  return store[id] || null;
}

export function loadConfig(id) {
  const rec = loadConfigRecord(id);
  return rec ? rec.config : null;
}

export function isOwner(record) {
  if (!record) return true; // no shared record => fresh local config
  return record.ownerToken === getOwnerToken();
}

export function buildShareUrl(id) {
  const base = window.location.origin + window.location.pathname;
  return `${base}?c=${encodeURIComponent(id)}`;
}

export function readUrlParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    configId: p.get('c'),
    moduleId: p.get('module'),
    stackId: p.get('stack')
  };
}
