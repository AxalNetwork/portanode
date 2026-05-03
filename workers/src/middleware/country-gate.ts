/**
 * Country-gate middleware.
 *
 * Enforces the export-control block right before any payment-bearing
 * transition (Stripe Checkout creation). The gate is *advisory* on quote
 * creation (we still capture the lead so sales can follow up under the
 * polite-block flow described in `/legal/export/`) and *enforced* at
 * checkout.
 *
 * Country resolution priority:
 *   1) Explicit body param (`country` field) — used by the public quote
 *      checkout call where the contact already declared a country.
 *   2) The quote / order row, if the route handler stashed it on
 *      `c.set('gateCountry', …)` before calling the gate.
 *   3) The Cloudflare edge `cf.country`. Not authoritative for shipping
 *      decisions (a VPN can mislead it) but a reasonable last resort to
 *      block obvious cases.
 */
import type { MiddlewareHandler } from 'hono';
import type { AppContext } from '../env';
import { ApiError } from '../lib/errors';
import { isCountryRestricted } from '../lib/restricted-countries';
import { newShortId } from '../lib/ids';
import { logEvent } from '../db/events';

export function countryGate(
  resolve: (c: import('hono').Context<AppContext>) => Promise<string | null | undefined>,
): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    const country = (await resolve(c)) ?? null;
    if (!country) return next();
    const decision = await isCountryRestricted(c.env, country);
    if (!decision.blocked) return next();

    const requestId = c.get('requestId');
    const ip = c.get('ip');
    const customer = c.get('customer');
    // Lead-capture identity: prefer the authenticated customer, fall back
    // to the quote contact if a resolver pre-loaded one (anonymous
    // token-bearer flow) so ops still has an email + quote id to follow up.
    const preQuote = c.get('preloadedQuote') as
      | { id?: string; customerId?: string; contact?: { email?: string | null } }
      | null
      | undefined;
    const captureEmail = customer?.email ?? preQuote?.contact?.email ?? null;
    const captureCustomerId = customer?.id ?? preQuote?.customerId ?? null;
    const quoteId = preQuote?.id ?? c.req.param('id') ?? null;
    const id = `rb_${newShortId()}`;
    try {
      await c.env.DB.prepare(
        `INSERT INTO restricted_blocks
           (id, country, list_source, context, customer_id, email, request_id, ip, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          country.toUpperCase(),
          decision.source,
          c.req.path.includes('checkout') ? 'checkout' : 'quote',
          captureCustomerId,
          captureEmail,
          requestId,
          ip,
          Date.now(),
        )
        .run();
      await logEvent(c.env.DB, {
        type: 'compliance.country_blocked',
        actorKind: customer ? 'customer' : 'system',
        actorId: customer?.id ?? null,
        subjectKind: quoteId ? 'quote' : 'customer',
        subjectId: quoteId ?? captureCustomerId ?? null,
        requestId,
        ip,
        payload: {
          country: country.toUpperCase(),
          source: decision.source,
          quoteId,
          email: captureEmail,
        },
      });
    } catch {
      // Best-effort logging only — never fail the polite-block on a log error.
    }
    throw new ApiError(
      451, // Unavailable For Legal Reasons (RFC 7725)
      'restricted',
      'AXAL cannot ship to this destination under applicable export controls. Please contact compliance@axal.dev so we can review your case.',
      { country: country.toUpperCase() },
    );
  };
}
