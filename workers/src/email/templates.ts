/**
 * Email templates.
 *
 * Source MJML lives in `workers/src/email/templates/*.mjml`. The build step
 * (`scripts/build-email-templates.mjs`) compiles them to inline-styled HTML
 * and writes them to `src/email/compiled/*.html` for production use.
 *
 * For local dev (and to keep the worker bundle dependency-free), we ship a
 * minimal hand-tuned HTML fallback inline below — same vars, same styling
 * tokens. The compiled MJML output replaces these at deploy time.
 */

export type TemplateName =
  | 'magic-link'
  | 'contact-received'
  | 'leasing-received'
  | 'spec-download'
  | 'quote-sent'
  | 'order-deposit-received'
  | 'order-status-update';

const BRAND = {
  primary: '#6B21A8',
  ink: '#0B0B0F',
  paper: '#FAFAF7',
  gray: '#6B7280',
};

function shell(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title></head>
<body style="margin:0;background:${BRAND.paper};font-family:Inter,Geist,Helvetica,Arial,sans-serif;color:${BRAND.ink};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.paper};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #eee;border-radius:12px;overflow:hidden;">
      <tr><td style="padding:24px 28px;border-bottom:1px solid #eee;">
        <span style="font-weight:700;letter-spacing:0.04em;color:${BRAND.primary};">AXAL</span>
      </td></tr>
      <tr><td style="padding:28px;font-size:15px;line-height:1.55;">${body}</td></tr>
      <tr><td style="padding:18px 28px;border-top:1px solid #eee;font-size:12px;color:${BRAND.gray};">
        AXAL · Modular infrastructure, deployed where you need it.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

const T: Record<TemplateName, (v: Record<string, unknown>) => string> = {
  'magic-link': (v) =>
    shell('Sign in to AXAL', `
      <h1 style="margin:0 0 12px;font-size:22px;">Your sign-in link</h1>
      <p>Click the button below to sign in to your AXAL account. This link expires in ${esc(v.ttlMinutes)} minutes and can only be used once.</p>
      <p style="margin:24px 0;"><a href="${esc(v.link)}" style="background:${BRAND.primary};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600;">Sign in to AXAL</a></p>
      <p style="font-size:13px;color:${BRAND.gray};">If you didn't request this email, you can safely ignore it. Questions? <a href="mailto:${esc(v.supportEmail)}">${esc(v.supportEmail)}</a></p>
    `),
  'contact-received': (v) =>
    shell('We received your message', `
      <h1 style="margin:0 0 12px;font-size:22px;">Thanks, ${esc(v.name ?? 'there')}.</h1>
      <p>We received your message and our team will reply within one business day.</p>
      <p style="font-size:13px;color:${BRAND.gray};">Reference: ${esc(v.leadId)}</p>
    `),
  'leasing-received': (v) =>
    shell('Leasing inquiry received', `
      <h1 style="margin:0 0 12px;font-size:22px;">Leasing inquiry received</h1>
      <p>Thanks ${esc(v.name ?? '')}, our financing partner will reach out within two business days with options for ${esc(v.region ?? 'your region')}.</p>
      <p style="font-size:13px;color:${BRAND.gray};">Reference: ${esc(v.leadId)}</p>
    `),
  'spec-download': (v) =>
    shell('Your AXAL spec sheet', `
      <h1 style="margin:0 0 12px;font-size:22px;">Here's your spec sheet</h1>
      <p>Click below to download <strong>${esc(v.assetTitle)}</strong> (PDF).</p>
      <p style="margin:24px 0;"><a href="${esc(v.downloadUrl)}" style="background:${BRAND.primary};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600;">Download PDF</a></p>
    `),
  'quote-sent': (v) =>
    shell('Your AXAL quote', `
      <h1 style="margin:0 0 12px;font-size:22px;">Quote ${esc(v.quoteId)}</h1>
      <p>Total: <strong>${esc(v.totalDisplay)}</strong> · Deposit: <strong>${esc(v.depositDisplay)}</strong></p>
      <p>Valid until ${esc(v.expiresOn)}.</p>
      <p style="margin:24px 0;"><a href="${esc(v.quoteUrl)}" style="background:${BRAND.primary};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600;">Review your quote</a></p>
    `),
  'order-deposit-received': (v) =>
    shell('Deposit received', `
      <h1 style="margin:0 0 12px;font-size:22px;">Deposit received — order ${esc(v.orderId)}</h1>
      <p>We've queued your order into manufacturing. Expected ship window: ${esc(v.expectedShip ?? 'TBD')}.</p>
      <p style="margin:24px 0;"><a href="${esc(v.orderUrl)}" style="background:${BRAND.primary};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600;">Track your order</a></p>
    `),
  'order-status-update': (v) =>
    shell('Order update', `
      <h1 style="margin:0 0 12px;font-size:22px;">Order ${esc(v.orderId)}: ${esc(v.statusLabel)}</h1>
      <p>${esc(v.message)}</p>
      <p style="margin:24px 0;"><a href="${esc(v.orderUrl)}" style="background:${BRAND.primary};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600;">View order</a></p>
    `),
};

export const templates = T;

export function renderTemplate(name: TemplateName, vars: Record<string, unknown>): string {
  const fn = T[name];
  if (!fn) throw new Error(`Unknown template: ${name}`);
  return fn(vars);
}

function esc(v: unknown): string {
  return escape(v == null ? '' : String(v));
}
function escape(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
