/**
 * Quote PDF rendering. Outputs an AXAL-letterhead HTML document with print
 * stylesheet that renders cleanly to PDF in any modern browser. When the
 * Cloudflare Browser Rendering binding (`env.BROWSER`) is bound, the worker
 * additionally generates a real PDF and caches it to R2; otherwise the HTML
 * itself is returned with `Content-Type: text/html` and a print stylesheet.
 *
 * Cache key: `quotes/{quoteId}.pdf` in R2.
 */
import type { Env } from '../env';
import type { HydratedQuote } from './quotes';
import { convertCentsByRate, formatMoney } from '../lib/fx';
import { getConfiguration } from './configurations';

interface BrowserBinding {
  fetch: (req: Request) => Promise<Response>;
}

function escape(s: unknown): string {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function renderQuoteHtml(env: Env, q: HydratedQuote): Promise<string> {
  const cfg = await getConfiguration(env, q.configurationId);
  // Use the FX rate snapshotted on the quote — the same rate Stripe Checkout
  // and the email use — so the printed PDF is a faithful, frozen artifact.
  const local = (cents: number) =>
    formatMoney(convertCentsByRate(cents, q.fxRate, q.currency), q.currency);
  const usd = (cents: number) => formatMoney(cents, 'USD');

  const bom = renderBom(cfg?.payload);
  const issued = new Date(q.createdAt).toISOString().slice(0, 10);
  const expires = new Date(q.expiresAt).toISOString().slice(0, 10);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>AXAL Quote ${escape(q.id)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { font-family: Inter, -apple-system, "Helvetica Neue", Arial, sans-serif; color:#0B0B0F; margin:0; }
  .brand { color:#6B21A8; font-weight:700; letter-spacing:.04em; font-size:18px; }
  header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #6B21A8; padding-bottom:14px; margin-bottom:22px; }
  h1 { font-size:22px; margin:0 0 4px; }
  .muted { color:#6B7280; font-size:12px; }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:8px 6px; border-bottom:1px solid #eee; font-size:13px; }
  th { color:#6B7280; text-transform:uppercase; font-size:11px; letter-spacing:.06em; }
  .totals { margin-top:18px; width:60%; margin-left:auto; }
  .totals td { padding:6px 4px; }
  .totals .label { color:#6B7280; }
  .totals .grand { font-weight:700; font-size:15px; border-top:2px solid #0B0B0F; }
  .deposit { background:#F4ECFF; color:#6B21A8; padding:10px 12px; border-radius:8px; margin-top:14px; font-weight:600; }
  footer { margin-top:36px; font-size:11px; color:#6B7280; border-top:1px solid #eee; padding-top:12px; }
  .meta { display:grid; grid-template-columns:1fr 1fr; gap:8px 18px; font-size:13px; }
  .meta div span { color:#6B7280; display:block; font-size:11px; text-transform:uppercase; letter-spacing:.06em; }
  @media print { .noprint { display:none; } }
  .printbtn { position:fixed; top:14px; right:14px; background:#6B21A8; color:#fff; padding:8px 14px; border-radius:6px; text-decoration:none; font-size:13px; }
</style>
</head><body>
<a class="noprint printbtn" href="javascript:window.print()">Print / Save PDF</a>
<header>
  <div>
    <div class="brand">AXAL</div>
    <div class="muted">Modular infrastructure, deployed where you need it.</div>
  </div>
  <div style="text-align:right;">
    <h1>Quote ${escape(q.id)}</h1>
    <div class="muted">Issued ${escape(issued)} · Valid until ${escape(expires)}</div>
  </div>
</header>

<section class="meta" style="margin-bottom:18px;">
  <div><span>Bill to</span>${escape(q.contact.company ?? q.contact.name ?? q.contact.email)}<br>${escape(
    q.contact.email,
  )}<br>${escape(q.contact.country ?? '')}</div>
  <div><span>Deployment</span>${escape(q.deploymentSite ?? '—')}<br><span style="margin-top:6px">Region</span>${escape(
    q.region.toUpperCase(),
  )}</div>
  <div><span>Use case</span>${escape(q.useCase ?? '—')}</div>
  <div><span>VAT ID</span>${escape(q.vatId ?? '—')}${q.vatValidatedAt ? ' <strong>(VIES verified)</strong>' : ''}</div>
</section>

<h2 style="font-size:14px; text-transform:uppercase; letter-spacing:.06em; color:#6B7280; margin:0 0 6px;">Bill of materials</h2>
<table>
  <thead><tr><th>Item</th><th>Qty</th><th style="text-align:right;">Price (USD)</th><th style="text-align:right;">${escape(
    q.currency,
  )}</th></tr></thead>
  <tbody>
    ${bom
      .map(
        (b) => `<tr><td>${escape(b.label)}</td><td>${escape(b.qty)}</td><td style="text-align:right;">${usd(
          b.priceUsdCents,
        )}</td><td style="text-align:right;">${local(b.priceUsdCents)}</td></tr>`,
      )
      .join('')}
  </tbody>
</table>

<table class="totals">
  <tr><td class="label">Subtotal</td><td style="text-align:right;">${usd(q.subtotalCents)}</td><td style="text-align:right;">${local(
    q.subtotalCents,
  )}</td></tr>
  ${q.customizationFeeCents ? `<tr><td class="label">Customization</td><td style="text-align:right;">${usd(q.customizationFeeCents)}</td><td style="text-align:right;">${local(q.customizationFeeCents)}</td></tr>` : ''}
  ${q.expediteFeeCents ? `<tr><td class="label">Expedite</td><td style="text-align:right;">${usd(q.expediteFeeCents)}</td><td style="text-align:right;">${local(q.expediteFeeCents)}</td></tr>` : ''}
  <tr><td class="label">Freight (est.)</td><td style="text-align:right;">${usd(q.freightCents)}</td><td style="text-align:right;">${local(
    q.freightCents,
  )}</td></tr>
  <tr><td class="label">Tax</td><td style="text-align:right;" colspan="2">Calculated at checkout</td></tr>
  <tr class="grand"><td>Total</td><td style="text-align:right;">${usd(q.totalCents)}</td><td style="text-align:right;">${local(
    q.totalCents,
  )}</td></tr>
</table>

<div class="deposit">Reservation deposit (20%): ${local(q.depositCents)} — secures your manufacturing slot. Balance invoiced at production scheduling.</div>

<footer>
  Quote ${escape(q.id)} · Valid 30 days from issue · Pricing in USD; ${escape(q.currency)} amounts shown for reference at FX rate ${escape(
    q.fxRate.toFixed(4),
  )}.<br>
  Refunds: 100% within 14 days · 50% within 30 days · 0% once your manufacturing slot is confirmed.<br>
  AXAL · hello@axal.example · This document is an offer and is non-binding until accepted by both parties via the linked checkout.
</footer>
</body></html>`;
}

interface BomLine {
  label: string;
  qty: number;
  priceUsdCents: number;
}

function renderBom(payload: unknown): BomLine[] {
  const out: BomLine[] = [];
  if (!payload || typeof payload !== 'object') return out;
  const p = payload as Record<string, unknown>;
  const items = (p.items ?? p.modules ?? p.lines) as unknown;
  if (Array.isArray(items)) {
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const r = it as Record<string, unknown>;
      const name = String(r.name ?? r.label ?? r.id ?? 'Module');
      const qty = Number(r.qty ?? r.quantity ?? 1);
      const priceUsd = Number(r.priceUsd ?? r.basePrice ?? 0);
      out.push({ label: name, qty, priceUsdCents: Math.round(priceUsd * 100) });
    }
  }
  if (out.length === 0) {
    out.push({ label: 'Configuration line items (see attached configuration)', qty: 1, priceUsdCents: 0 });
  }
  return out;
}

export async function renderQuotePdfBytes(env: Env, q: HydratedQuote): Promise<Uint8Array | null> {
  const browser = env.BROWSER as BrowserBinding | undefined;
  if (!browser) return null;
  const html = await renderQuoteHtml(env, q);
  // Cloudflare Browser Rendering REST contract (workers binding form):
  //   POST /pdf with { html } returns application/pdf bytes.
  const res = await browser.fetch(
    new Request('https://browser/pdf', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html, viewport: { width: 1240, height: 1754 } }),
    }),
  );
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

export async function getOrRenderQuotePdf(
  env: Env,
  q: HydratedQuote,
): Promise<{ kind: 'pdf'; bytes: Uint8Array } | { kind: 'html'; html: string }> {
  const cacheKey = `quotes/${q.id}.pdf`;
  if (q.pdfR2Key) {
    const obj = await env.ASSETS.get(q.pdfR2Key);
    if (obj) return { kind: 'pdf', bytes: new Uint8Array(await obj.arrayBuffer()) };
  }
  const bytes = await renderQuotePdfBytes(env, q);
  if (bytes) {
    await env.ASSETS.put(cacheKey, bytes, {
      httpMetadata: { contentType: 'application/pdf' },
    });
    return { kind: 'pdf', bytes };
  }
  return { kind: 'html', html: await renderQuoteHtml(env, q) };
}
