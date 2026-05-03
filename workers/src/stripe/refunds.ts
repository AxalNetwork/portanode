/**
 * Refund policy + Stripe execution.
 *
 * Policy bands (measured from order.created_at):
 *   - within 14 days .................... 100% refund of payments to date
 *   - 15–30 days ........................ 50%
 *   - after 30 days OR status >= in_production .. 0% (no automatic refund)
 *
 * Admins can `override` the band via the admin endpoint when an exceptional
 * case requires a different amount; the override is recorded in the audit
 * log and on the refund row.
 */
import type { Env } from '../env';
import { stripeRequest } from './client';

export type RefundBand = 'full' | 'half' | 'none' | 'override';

export interface RefundComputation {
  band: RefundBand;
  maxRefundCents: number;
  reason: string;
}

export interface RefundOrderShape {
  id: string;
  status: string;
  totalCents: number;
  depositPaidCents: number;
  balancePaidCents: number;
  refundedCents: number;
  createdAt: number;
}

const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

const PRODUCTION_STATUSES = new Set(['in_production', 'shipping', 'delivered']);

export function computeRefundEligibility(order: RefundOrderShape, now = Date.now()): RefundComputation {
  const paid = order.depositPaidCents + order.balancePaidCents;
  const remaining = paid - order.refundedCents;
  if (remaining <= 0) {
    return { band: 'none', maxRefundCents: 0, reason: 'Nothing left to refund' };
  }
  if (PRODUCTION_STATUSES.has(order.status)) {
    return {
      band: 'none',
      maxRefundCents: 0,
      reason: 'Manufacturing slot confirmed — no automatic refund',
    };
  }
  const age = now - order.createdAt;
  if (age <= FOURTEEN_DAYS) {
    return { band: 'full', maxRefundCents: remaining, reason: 'Within 14-day full refund window' };
  }
  if (age <= THIRTY_DAYS) {
    return {
      band: 'half',
      maxRefundCents: Math.floor(remaining / 2),
      reason: 'Within 30-day partial refund window',
    };
  }
  return { band: 'none', maxRefundCents: 0, reason: 'Past 30-day window' };
}

export interface ExecuteRefundArgs {
  paymentIntentId: string;
  amountCents: number;
  reason?: string;
  refundLedgerId: string;   // our internal refunds.id, used as idempotency key
  metadata?: Record<string, string>;
}

export interface StripeRefund {
  id: string;
  status: string;          // 'pending'|'requires_action'|'succeeded'|'failed'|'canceled'
  amount: number;
  currency: string;
  payment_intent: string;
}

export async function executeStripeRefund(env: Env, args: ExecuteRefundArgs): Promise<StripeRefund> {
  return stripeRequest<StripeRefund>(
    env,
    '/v1/refunds',
    {
      payment_intent: args.paymentIntentId,
      amount: args.amountCents,
      reason: args.reason ?? 'requested_by_customer',
      metadata: { ledger_id: args.refundLedgerId, ...(args.metadata ?? {}) },
    },
    { idempotencyKey: `axal:refund:${args.refundLedgerId}` },
  );
}
