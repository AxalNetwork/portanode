/**
 * Daily-cached FX rates vs USD. Falls back to a small built-in table if the
 * remote provider is unreachable so checkout flows never block on a failing
 * 3rd-party. Stripe Checkout itself accepts the resolved currency directly.
 */
import type { Env } from '../env';
import { log } from './log';

const FX_KEY = 'fx:usd:v1';
const FX_TTL = 60 * 60 * 24; // 24h

/** Country code (ISO-3166 alpha-2) → presentment currency where Stripe is well-supported. */
const COUNTRY_TO_CURRENCY: Record<string, string> = {
  US: 'USD', CA: 'CAD', MX: 'MXN', BR: 'BRL',
  GB: 'GBP', IE: 'EUR', FR: 'EUR', DE: 'EUR', ES: 'EUR', IT: 'EUR',
  NL: 'EUR', BE: 'EUR', PT: 'EUR', AT: 'EUR', FI: 'EUR', GR: 'EUR',
  SE: 'SEK', NO: 'NOK', DK: 'DKK', CH: 'CHF', PL: 'PLN', CZ: 'CZK',
  AU: 'AUD', NZ: 'NZD', JP: 'JPY', SG: 'SGD', HK: 'HKD', KR: 'KRW',
  IN: 'INR', AE: 'AED', SA: 'SAR', ZA: 'ZAR', NG: 'NGN', KE: 'KES',
};

const FALLBACK_RATES: Record<string, number> = {
  USD: 1, EUR: 0.92, GBP: 0.79, CAD: 1.36, MXN: 17.5, BRL: 5.0, AUD: 1.5,
  NZD: 1.62, JPY: 150, SGD: 1.34, HKD: 7.82, KRW: 1340, INR: 83, AED: 3.67,
  SAR: 3.75, ZAR: 18.4, NGN: 1500, KES: 129, SEK: 10.6, NOK: 10.9, DKK: 6.85,
  CHF: 0.88, PLN: 4.0, CZK: 23.0,
};

const STRIPE_SUPPORTED = new Set(Object.keys(FALLBACK_RATES));

export function currencyForCountry(country: string | null | undefined): string {
  if (!country) return 'USD';
  return COUNTRY_TO_CURRENCY[country.toUpperCase()] ?? 'USD';
}

export function isSupportedCurrency(code: string): boolean {
  return STRIPE_SUPPORTED.has(code.toUpperCase());
}

export interface FxTable {
  base: 'USD';
  rates: Record<string, number>;
  fetchedAt: number;
}

export async function getFxTable(env: Env): Promise<FxTable> {
  try {
    const cached = await env.CACHE.get(FX_KEY);
    if (cached) return JSON.parse(cached) as FxTable;
  } catch {
    /* ignore */
  }

  const fresh = await fetchFxFromProvider().catch(() => null);
  const table: FxTable = fresh ?? { base: 'USD', rates: FALLBACK_RATES, fetchedAt: Date.now() };
  try {
    await env.CACHE.put(FX_KEY, JSON.stringify(table), { expirationTtl: FX_TTL });
  } catch (err) {
    log.warn({ msg: 'fx.cache_write_failed', err: String(err) });
  }
  return table;
}

async function fetchFxFromProvider(): Promise<FxTable | null> {
  // exchangerate.host is a free, no-auth FX endpoint. We pin a small list to
  // keep the payload small and predictable.
  const symbols = Object.keys(FALLBACK_RATES).join(',');
  const url = `https://api.exchangerate.host/latest?base=USD&symbols=${symbols}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) return null;
  const json = (await res.json()) as { base?: string; rates?: Record<string, number> };
  if (!json.rates || json.base !== 'USD') return null;
  // Always include USD=1 for completeness.
  return { base: 'USD', rates: { USD: 1, ...json.rates }, fetchedAt: Date.now() };
}

/**
 * Convert an integer USD-cents amount into the requested currency, returning
 * an integer minor-unit amount sized for that currency (JPY/KRW are zero-
 * decimal, everything else is two-decimal — the small set we support has no
 * three-decimal currencies).
 */
export function convertCents(usdCents: number, toCurrency: string, table: FxTable): number {
  const code = toCurrency.toUpperCase();
  const rate = table.rates[code];
  if (!rate || code === 'USD') return Math.round(usdCents);
  return convertCentsByRate(usdCents, rate, code);
}

/**
 * Deterministic conversion using an explicit snapshotted rate (the value we
 * persisted on the quote at creation time). This is the conversion we use
 * everywhere customer-visible — quote page, Stripe Checkout line items, PDF
 * — so totals never drift due to FX market moves between quote and pay.
 */
export function convertCentsByRate(usdCents: number, rate: number, toCurrency: string): number {
  const code = toCurrency.toUpperCase();
  if (code === 'USD' || !rate) return Math.round(usdCents);
  const usd = usdCents / 100;
  const target = usd * rate;
  return zeroDecimal(code) ? Math.round(target) : Math.round(target * 100);
}

/**
 * Inverse of {@link convertCentsByRate}: converts a presentment-currency
 * minor-unit amount (what Stripe sends back on the webhook) into USD cents
 * using the same snapshotted rate. Used to keep order monetary columns
 * canonically in USD regardless of the customer's presentment currency.
 */
export function presentmentToUsdCents(
  presentmentMinor: number,
  rate: number,
  fromCurrency: string,
): number {
  const code = fromCurrency.toUpperCase();
  if (code === 'USD' || !rate) return Math.round(presentmentMinor);
  const target = zeroDecimal(code) ? presentmentMinor : presentmentMinor / 100;
  const usd = target / rate;
  return Math.round(usd * 100);
}

export function zeroDecimal(currency: string): boolean {
  // Stripe's zero-decimal subset that we care about.
  return ['JPY', 'KRW', 'VND', 'CLP', 'BIF', 'DJF', 'GNF', 'PYG', 'RWF', 'UGX', 'XAF', 'XOF'].includes(
    currency.toUpperCase(),
  );
}

export function formatMoney(amount: number, currency: string): string {
  const code = currency.toUpperCase();
  const value = zeroDecimal(code) ? amount : amount / 100;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(value);
  } catch {
    return `${value.toFixed(zeroDecimal(code) ? 0 : 2)} ${code}`;
  }
}
