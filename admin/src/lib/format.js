export function fmtMoney(cents, currency = 'USD') {
  if (cents == null) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format((cents || 0) / 100);
  } catch {
    return `$${((cents || 0) / 100).toFixed(0)}`;
  }
}

export function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toISOString().slice(0, 10);
}

export function fmtDateTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}

export function fmtRel(ms) {
  if (!ms) return '—';
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const day = 24 * 60 * 60 * 1000;
  if (abs < 60_000) return 'now';
  if (abs < 60 * 60_000) return `${Math.round(abs / 60_000)}m ${diff < 0 ? 'ago' : 'left'}`;
  if (abs < day) return `${Math.round(abs / (60 * 60_000))}h ${diff < 0 ? 'ago' : 'left'}`;
  return `${Math.round(abs / day)}d ${diff < 0 ? 'ago' : 'left'}`;
}

export function statusPill(status) {
  const map = {
    new: 'info',
    contacted: 'info',
    qualified: 'ok',
    closed: 'muted',
    spam: 'danger',
    draft: 'muted',
    sent: 'info',
    accepted: 'ok',
    expired: 'warn',
    cancelled: 'muted',
    awaiting_deposit: 'warn',
    reserved: 'warn',
    in_production: 'info',
    shipping: 'info',
    delivered: 'ok',
    refunded: 'danger',
  };
  return map[status] || 'muted';
}
