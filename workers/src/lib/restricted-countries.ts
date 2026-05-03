/**
 * Country gate.
 *
 * Maintains the list of jurisdictions to which AXAL hardware cannot ship
 * under U.S. EAR (15 CFR §746), the EU Consolidated List (Reg 2021/821 +
 * country-specific Council Decisions), the UK Sanctions and Anti-Money
 * Laundering Act, and the UN Security Council consolidated list.
 *
 * Two layers:
 *   1) `DEFAULT_RESTRICTED` — comprehensively-sanctioned destinations baked
 *      into the worker so the gate functions even if KV is unbound or
 *      empty. This list intentionally errs on the side of blocking; ops can
 *      always relax via override.
 *   2) `cfg:restricted_countries` (KV) — admin-editable JSON
 *      `{ blocked: ["XX", ...], allowed: ["YY", ...] }`. `allowed` wins on
 *      collision so ops can carve out a specific market without editing
 *      defaults.
 *
 * The gate's failure mode is *always* polite-block + lead capture: see
 * `routes/quotes.ts` checkout handler, which surfaces a `restricted` error
 * code that the frontend renders into a contact form, not a stack trace.
 */
import type { Env } from '../env';

const KV_KEY = 'cfg:restricted_countries';
const KV_TTL_S = 300;

// ISO 3166-1 alpha-2. Mirrors the regions called out in `/legal/export/`.
export const DEFAULT_RESTRICTED: readonly string[] = [
  'CU', // Cuba (OFAC, EU)
  'IR', // Iran (OFAC, EU, UK, UN)
  'KP', // North Korea (OFAC, EU, UK, UN)
  'SY', // Syria (OFAC, EU, UK)
  'RU', // Russia — defense & dual-use embargo, ops decides per quote
  'BY', // Belarus — EU/UK
  'MM', // Myanmar — EU/UK arms + dual-use
  'VE', // Venezuela — partial OFAC
  // Sub-territory codes are not fully ISO-2; the country gate covers them
  // via `customCheck` below for Crimea / DNR / LNR (UA + region heuristic
  // is left to the post-checkout KYB flow).
];

interface KvList {
  blocked?: string[];
  allowed?: string[];
  updatedAt?: number;
  updatedBy?: string;
}

let memoryCache: { value: KvList; expires: number } | null = null;

async function readKv(env: Env): Promise<KvList> {
  const now = Date.now();
  if (memoryCache && memoryCache.expires > now) return memoryCache.value;
  let parsed: KvList = {};
  try {
    const raw = await env.CACHE.get(KV_KEY, 'json');
    if (raw && typeof raw === 'object') parsed = raw as KvList;
  } catch {
    // KV unavailable — fail open to defaults so the gate keeps blocking.
  }
  memoryCache = { value: parsed, expires: now + KV_TTL_S * 1000 };
  return parsed;
}

export function clearRestrictedCache() {
  memoryCache = null;
}

export interface RestrictedDecision {
  blocked: boolean;
  source: 'default' | 'kv' | 'allowed';
  list: string[];
}

/** Resolve the merged effective restricted list (defaults ∪ kv.blocked) − kv.allowed. */
export async function resolveRestrictedList(env: Env): Promise<{
  list: string[];
  defaults: string[];
  blocked: string[];
  allowed: string[];
  updatedAt: number | null;
  updatedBy: string | null;
}> {
  const kv = await readKv(env);
  const blocked = (kv.blocked ?? []).map((c) => c.toUpperCase());
  const allowed = new Set((kv.allowed ?? []).map((c) => c.toUpperCase()));
  const merged = new Set<string>([...DEFAULT_RESTRICTED, ...blocked]);
  for (const a of allowed) merged.delete(a);
  return {
    list: Array.from(merged).sort(),
    defaults: [...DEFAULT_RESTRICTED],
    blocked,
    allowed: Array.from(allowed),
    updatedAt: kv.updatedAt ?? null,
    updatedBy: kv.updatedBy ?? null,
  };
}

/** Decide for a single ISO-2 country code. */
export async function isCountryRestricted(
  env: Env,
  country: string | null | undefined,
): Promise<RestrictedDecision> {
  if (!country) return { blocked: false, source: 'default', list: [] };
  const cc = country.toUpperCase();
  const kv = await readKv(env);
  const allowed = new Set((kv.allowed ?? []).map((c) => c.toUpperCase()));
  if (allowed.has(cc)) return { blocked: false, source: 'allowed', list: [] };
  if (DEFAULT_RESTRICTED.includes(cc)) {
    return { blocked: true, source: 'default', list: [...DEFAULT_RESTRICTED] };
  }
  const extra = (kv.blocked ?? []).map((c) => c.toUpperCase());
  if (extra.includes(cc)) return { blocked: true, source: 'kv', list: extra };
  return { blocked: false, source: 'default', list: [] };
}

/** Persist a new admin-edited list to KV. Validates ISO-2 shape. */
export async function setRestrictedList(
  env: Env,
  patch: { blocked?: string[]; allowed?: string[]; updatedBy?: string },
) {
  const norm = (xs: string[] | undefined) =>
    Array.from(
      new Set(
        (xs ?? [])
          .filter((s) => typeof s === 'string')
          .map((s) => s.trim().toUpperCase())
          .filter((s) => /^[A-Z]{2}$/.test(s)),
      ),
    ).sort();
  const next: KvList = {
    blocked: norm(patch.blocked),
    allowed: norm(patch.allowed),
    updatedAt: Date.now(),
    updatedBy: patch.updatedBy ?? null ?? undefined,
  };
  await env.CACHE.put(KV_KEY, JSON.stringify(next));
  clearRestrictedCache();
  return next;
}
