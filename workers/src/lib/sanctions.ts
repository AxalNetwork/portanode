/**
 * Sanctions screening.
 *
 * Every new customer is screened against the OpenSanctions matcher endpoint
 * (https://www.opensanctions.org/docs/api/) which aggregates OFAC SDN, EU
 * Consolidated, UK Sanctions, UN Consolidated, and PEPs. The match scoring
 * happens server-side; we persist the top hits + score and flag the
 * customer for admin review when the threshold is exceeded.
 *
 * Failure modes:
 *   - No `OPENSANCTIONS_API_KEY` configured → the screening is recorded as
 *     `cleared` with `provider='stub'` so the audit trail remains
 *     consistent across environments and we don't accidentally block legit
 *     customers in dev. Production must configure the key.
 *   - Provider error / timeout → screening is `cleared` with provider
 *     `error` and `notes` capture the failure. The customer is allowed to
 *     proceed but the row is surfaced for retry in the admin console.
 *
 * The threshold (default 0.85) and timeout (default 4s) are env-tunable.
 */
import type { Env } from '../env';
import { newShortId } from './ids';

const ENDPOINT = 'https://api.opensanctions.org/match/default';
const DEFAULT_THRESHOLD = 0.85;
const DEFAULT_TIMEOUT_MS = 4000;

export interface SanctionsMatch {
  id: string;
  name: string;
  schema: string;
  score: number;
  topics?: string[];
  datasets?: string[];
}

export interface SanctionsResult {
  status: 'clear' | 'review' | 'error';
  matchCount: number;
  topScore: number | null;
  matches: SanctionsMatch[];
  provider: 'opensanctions' | 'stub' | 'error';
  notes?: string;
}

interface OpenSanctionsResponse {
  responses?: Record<
    string,
    {
      results?: Array<{
        id: string;
        caption?: string;
        schema?: string;
        score?: number;
        properties?: { topics?: string[] };
        datasets?: string[];
      }>;
    }
  >;
}

/** Run a single screening request. Pure function — caller persists. */
export async function screenName(
  env: Env,
  query: { name: string; country?: string | null; email?: string | null },
): Promise<SanctionsResult> {
  if (!env.OPENSANCTIONS_API_KEY) {
    return { status: 'clear', matchCount: 0, topScore: null, matches: [], provider: 'stub' };
  }
  const threshold = parseFloat(env.SANCTIONS_THRESHOLD ?? '') || DEFAULT_THRESHOLD;
  const timeoutMs = parseInt(env.SANCTIONS_TIMEOUT_MS ?? '', 10) || DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const body = {
      queries: {
        q1: {
          schema: 'Person',
          properties: {
            name: [query.name],
            ...(query.country ? { country: [query.country] } : {}),
          },
        },
      },
    };
    const url = new URL(ENDPOINT);
    url.searchParams.set('algorithm', 'best');
    url.searchParams.set('threshold', String(threshold));
    url.searchParams.set('limit', '5');
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `ApiKey ${env.OPENSANCTIONS_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return {
        status: 'error',
        matchCount: 0,
        topScore: null,
        matches: [],
        provider: 'error',
        notes: `opensanctions.http_${res.status}`,
      };
    }
    const json = (await res.json()) as OpenSanctionsResponse;
    const results = json.responses?.q1?.results ?? [];
    const matches: SanctionsMatch[] = results.map((r) => ({
      id: r.id,
      name: r.caption ?? '',
      schema: r.schema ?? 'Person',
      score: typeof r.score === 'number' ? r.score : 0,
      topics: r.properties?.topics,
      datasets: r.datasets,
    }));
    const topScore = matches.length ? Math.max(...matches.map((m) => m.score)) : null;
    const status: SanctionsResult['status'] =
      topScore != null && topScore >= threshold ? 'review' : 'clear';
    return {
      status,
      matchCount: matches.length,
      topScore,
      matches,
      provider: 'opensanctions',
    };
  } catch (err) {
    return {
      status: 'error',
      matchCount: 0,
      topScore: null,
      matches: [],
      provider: 'error',
      notes: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(t);
  }
}

/** Persist a screening row + mirror flag onto the customer. Idempotent per call. */
export async function recordScreening(
  env: Env,
  args: {
    customerId: string;
    name: string;
    country: string | null;
    result: SanctionsResult;
  },
): Promise<{ id: string }> {
  const id = `scr_${newShortId()}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO sanctions_screenings
       (id, customer_id, status, query_name, query_country, match_count,
        top_score, matches_json, provider, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      args.customerId,
      args.result.status === 'error' ? 'pending' : args.result.status,
      args.name,
      args.country,
      args.result.matchCount,
      args.result.topScore,
      args.result.matches.length ? JSON.stringify(args.result.matches) : null,
      args.result.provider,
      now,
    )
    .run();

  // Mirror onto the customer row only when the screening is conclusive; an
  // 'error' row leaves the prior status intact (defaults to 'clear' on new
  // customers) so a transient provider outage doesn't quarantine them.
  if (args.result.status !== 'error') {
    await env.DB.prepare(
      `UPDATE customers
          SET sanctions_status = ?, sanctions_reviewed_at = ?
        WHERE id = ?`,
    )
      .bind(args.result.status, now, args.customerId)
      .run();
  }
  return { id };
}

/**
 * Centralized "screen + persist + log" used at every customer-creation
 * site (auth magic-link, Stripe webhook upsert, future seat invites).
 * Failure modes are absorbed here so the caller never has to think about
 * compliance plumbing — a provider outage logs `compliance.sanctions_failed`
 * but does not block customer creation. Screening rows are always written
 * (even on error) so audit can see the attempt was made.
 */
export async function screenAndRecordCustomer(
  env: Env,
  args: {
    customerId: string;
    name: string;
    email?: string | null;
    country?: string | null;
    requestId?: string | null;
    ip?: string | null;
  },
): Promise<SanctionsResult> {
  // Late-import to avoid a cycle (events helper has no deps the other way).
  const { logEvent } = await import('../db/events');
  try {
    const screened = await screenName(env, {
      name: args.name,
      country: args.country ?? null,
      email: args.email ?? null,
    });
    await recordScreening(env, {
      customerId: args.customerId,
      name: args.name,
      country: args.country ?? null,
      result: screened,
    });
    if (screened.status === 'review') {
      await logEvent(env.DB, {
        type: 'compliance.sanctions_review',
        actorKind: 'system',
        subjectKind: 'customer',
        subjectId: args.customerId,
        requestId: args.requestId ?? null,
        ip: args.ip ?? null,
        payload: { topScore: screened.topScore, matchCount: screened.matchCount },
      });
    }
    return screened;
  } catch (err) {
    await logEvent(env.DB, {
      type: 'compliance.sanctions_failed',
      actorKind: 'system',
      subjectKind: 'customer',
      subjectId: args.customerId,
      requestId: args.requestId ?? null,
      ip: args.ip ?? null,
      payload: { err: err instanceof Error ? err.message : String(err) },
    });
    return {
      status: 'error',
      matchCount: 0,
      topScore: null,
      matches: [],
      provider: 'error',
      notes: err instanceof Error ? err.message : String(err),
    };
  }
}
