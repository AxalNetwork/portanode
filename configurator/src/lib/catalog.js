let _catalogPromise = null;

export function loadCatalog(url = '/assets/configurator/catalog.json') {
  if (!_catalogPromise) {
    _catalogPromise = fetch(url, { credentials: 'same-origin' })
      .then((r) => {
        if (!r.ok) throw new Error('catalog fetch failed: ' + r.status);
        return r.json();
      });
  }
  return _catalogPromise;
}

export function findModule(catalog, id) {
  return catalog.modules.find((m) => m.id === id);
}
export function findOption(module, id) {
  return module.options.find((o) => o.id === id);
}

export function defaultOptionsFor(module) {
  return module.options.filter((o) => o.default).map((o) => o.id);
}

export function formatCurrency(n, currency = 'USD') {
  if (n == null || isNaN(n)) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0
    }).format(n);
  } catch (e) {
    return '$' + Math.round(n).toLocaleString();
  }
}

export function formatNumber(n, suffix = '') {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 }) + suffix;
}
