/**
 * KYB threshold gate.
 *
 * Orders whose USD total exceeds `KYB_THRESHOLD_USD` (default $250,000) are
 * automatically marked `kyb_status='pending'` when they are materialised
 * from a Stripe Checkout. Production work is held until ops clears the
 * order via Sumsub / Onfido / Persona — the actual provider integration
 * lives in admin and isn't called by the webhook path; we just gate.
 */
import type { Env } from '../env';

const DEFAULT_THRESHOLD_USD = 250_000;

export function kybThresholdCents(env: Env): number {
  const v = parseFloat(env.KYB_THRESHOLD_USD ?? '');
  const usd = Number.isFinite(v) && v > 0 ? v : DEFAULT_THRESHOLD_USD;
  return Math.round(usd * 100);
}

export function shouldHoldForKyb(env: Env, totalUsdCents: number): boolean {
  return totalUsdCents >= kybThresholdCents(env);
}
