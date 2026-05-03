export function fmtMoney(amountCents, currency, fxRate) {
  if (amountCents == null) return '—';
  const rate = fxRate || 1;
  const local = currency && currency !== 'USD' ? Math.round(amountCents * rate) : amountCents;
  const cur = currency || 'USD';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(local / 100);
  } catch {
    return `${(local / 100).toFixed(2)} ${cur}`;
  }
}

export function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toISOString().slice(0, 10);
}

export function fmtDateTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

export function statusPill(status) {
  const cls =
    status === 'delivered' ? 'acc-pill-ok' :
    status === 'cancelled' || status === 'refunded' || status === 'expired' ? 'acc-pill-danger' :
    status === 'in_production' || status === 'shipping' || status === 'accepted' ? 'acc-pill-info' :
    'acc-pill-warn';
  return cls;
}

export function humanStatus(s) {
  return (s || '').replace(/_/g, ' ');
}
