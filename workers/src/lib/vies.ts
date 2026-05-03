/**
 * EU VIES VAT validation for B2B reverse-charge handling. We use the public
 * REST endpoint; failures fall back to "unvalidated" rather than blocking
 * checkout — Stripe Tax will still apply the correct rate and ops can
 * reconcile manually if VIES is down.
 */
import { log } from './log';

const EU_COUNTRIES = new Set([
  'AT','BE','BG','CY','CZ','DE','DK','EE','EL','ES','FI','FR','HR','HU',
  'IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK','XI',
]);

export interface ViesResult {
  valid: boolean;
  country: string;
  vatNumber: string;
  name?: string;
  address?: string;
  validatedAt: number;
}

/** Parse "DE123456789" or "DE 123 456 789" into {country, number}. */
export function parseVatId(raw: string): { country: string; number: string } | null {
  const cleaned = raw.replace(/[\s.-]/g, '').toUpperCase();
  const m = cleaned.match(/^([A-Z]{2})([0-9A-Z]{2,15})$/);
  if (!m) return null;
  // VIES uses 'EL' for Greek IDs (instead of 'GR') — accept either.
  const country = m[1] === 'GR' ? 'EL' : m[1];
  if (!EU_COUNTRIES.has(country)) return null;
  return { country, number: m[2] };
}

export async function validateVatId(raw: string): Promise<ViesResult | null> {
  const parsed = parseVatId(raw);
  if (!parsed) return null;
  const url = `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${parsed.country}/vat/${parsed.number}`;
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      isValid?: boolean;
      name?: string;
      address?: string;
      countryCode?: string;
      vatNumber?: string;
    };
    return {
      valid: !!data.isValid,
      country: data.countryCode ?? parsed.country,
      vatNumber: data.vatNumber ?? parsed.number,
      name: data.name,
      address: data.address,
      validatedAt: Date.now(),
    };
  } catch (err) {
    log.warn({ msg: 'vies.error', err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export function isReverseChargeEligible(vat: ViesResult | null, billingCountry: string | null): boolean {
  if (!vat || !vat.valid) return false;
  if (!billingCountry) return false;
  // Reverse charge applies to cross-border B2B sales within the EU.
  return EU_COUNTRIES.has(billingCountry.toUpperCase()) && vat.country !== billingCountry.toUpperCase();
}
