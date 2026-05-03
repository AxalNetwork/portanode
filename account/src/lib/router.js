// Tiny hash-based router so the portal works on any static host without
// extra rewrites. Routes look like `#/orders/O-XXXX` or `#/profile`.
import { writable } from 'svelte/store';

function parse() {
  const h = (typeof location !== 'undefined' ? location.hash : '') || '#/';
  const path = h.replace(/^#/, '') || '/';
  const [pathname, search = ''] = path.split('?');
  const segments = pathname.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(search));
  return { pathname, segments, query };
}

export const route = writable(parse());

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => route.set(parse()));
}

export function navigate(path) {
  if (typeof window === 'undefined') return;
  if (!path.startsWith('#')) path = '#' + (path.startsWith('/') ? path : '/' + path);
  if (location.hash === path) {
    route.set(parse());
  } else {
    location.hash = path;
  }
}
