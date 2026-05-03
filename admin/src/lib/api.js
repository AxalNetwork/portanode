// Tiny fetch wrapper for the admin SPA. Auth is cookie-based — the SPA
// posts the bearer ADMIN_API_TOKEN to /admin/login, which sets an HttpOnly
// `axal_admin` cookie. Cloudflare basic auth at the edge is the outer gate;
// this cookie is the second factor on every request.
const API_BASE =
  (typeof window !== 'undefined' && window.AXAL_API_BASE) || '';

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

export const adminMe = () => api('/admin/me');
export const adminLogin = (token) => api('/admin/login', { method: 'POST', body: { token } });
export const adminLogout = () => api('/admin/logout', { method: 'POST' });

export const fetchDashboard = () => api('/admin/dashboard/counts');

export const fetchLeads = (kind, status) => {
  const q = new URLSearchParams();
  if (kind) q.set('kind', kind);
  if (status) q.set('status', status);
  return api('/admin/leads' + (q.toString() ? `?${q}` : ''));
};
export const patchLead = (id, body) => api(`/admin/leads/${id}`, { method: 'PATCH', body });

export const fetchOrders = (status) =>
  api('/admin/orders' + (status ? `?status=${encodeURIComponent(status)}` : ''));
export const fetchOrder = (id) => api(`/admin/orders/${id}`);
export const patchOrder = (id, body) => api(`/admin/orders/${id}`, { method: 'PATCH', body });
export const patchOrderKyb = (id, body) => api(`/admin/orders/${id}/kyb`, { method: 'PATCH', body });

export const fetchKybPending = () => api('/admin/compliance/kyb/pending');
export const fetchSanctionsScreenings = (status) =>
  api('/admin/compliance/sanctions' + (status ? `?status=${encodeURIComponent(status)}` : ''));
export const patchSanctionsScreening = (id, body) =>
  api(`/admin/compliance/sanctions/${id}`, { method: 'PATCH', body });
export const fetchRestrictedCountries = () => api('/admin/compliance/countries');
export const putRestrictedCountries = (body) =>
  api('/admin/compliance/countries', { method: 'PUT', body });
export const fetchRestrictedBlocks = () => api('/admin/compliance/blocks');
export const refundEligibility = (id) => api(`/admin/orders/${id}/refund-eligibility`);
export const issueBalance = (id, body) =>
  api(`/admin/orders/${id}/invoice-balance`, { method: 'POST', body: body || {} });
export const issueRefund = (body) => api('/admin/refunds', { method: 'POST', body });

export const fetchQuotes = (status) =>
  api('/admin/quotes' + (status ? `?status=${encodeURIComponent(status)}` : ''));

export const searchCustomers = (q) =>
  api('/admin/customers' + (q ? `?q=${encodeURIComponent(q)}` : ''));
export const fetchCustomer = (id) => api(`/admin/customers/${encodeURIComponent(id)}`);
export const fetchCustomerNotes = (id) => api(`/admin/customers/${encodeURIComponent(id)}/notes`);
export const addCustomerNote = (id, body) =>
  api(`/admin/customers/${encodeURIComponent(id)}/notes`, { method: 'POST', body: { body } });
export const deleteCustomerNote = (id) => api(`/admin/notes/${id}`, { method: 'DELETE' });

export const fetchTasks = (status, customerId) => {
  const q = new URLSearchParams();
  if (status) q.set('status', status);
  if (customerId) q.set('customerId', customerId);
  return api('/admin/tasks' + (q.toString() ? `?${q}` : ''));
};
export const createTask = (body) => api('/admin/tasks', { method: 'POST', body });
export const patchTask = (id, body) => api(`/admin/tasks/${id}`, { method: 'PATCH', body });
export const deleteTask = (id) => api(`/admin/tasks/${id}`, { method: 'DELETE' });

export const fetchSnapshots = () => api('/admin/pricing/snapshots');
export const takeSnapshot = (payload, notes) =>
  api('/admin/pricing/snapshot', { method: 'POST', body: { payload, notes } });
export const diffSnapshots = (body) =>
  api('/admin/pricing/diff', { method: 'POST', body: body || {} });

export const fetchExports = () => api('/admin/exports');
export const runExport = () => api('/admin/exports/run', { method: 'POST' });
export const exportObjectUrl = (key) =>
  `${API_BASE}/admin/exports/object?key=${encodeURIComponent(key)}`;

export const triggerDigest = () => api('/admin/cron/digest', { method: 'POST' });
export const triggerSnapshot = () => api('/admin/cron/snapshot', { method: 'POST' });
