import type { Env } from '../env';
import { newShortId } from '../lib/ids';

// Pricing review tooling: capture quarterly snapshots of `_data/catalog.json`
// and diff the most recent against the previous one so ops can see which
// modules / options changed price between price-list reviews.
//
// `_data/catalog.json` lives in the static repo (Jekyll) so the worker can't
// read it directly. The admin UI POSTs the current catalog JSON when the ops
// user clicks "Take snapshot"; we persist it verbatim along with the
// reported version string.

export interface CatalogSnapshot {
  id: string;
  takenAt: number;
  catalogVersion: string | null;
  payload: unknown;
  notes: string | null;
}

interface CatalogModule {
  id: string;
  name?: string;
  basePrice?: number;
  options?: { id: string; label?: string; priceDelta?: number }[];
}
interface CatalogPayload {
  version?: string;
  modules?: CatalogModule[];
}

/** Public surface for callers (e.g. routes) that pass through opaque catalog
 *  JSON. We re-export it so they don't reach into `as any` casts. */
export type CatalogPayloadInput = CatalogPayload;

export async function takeSnapshot(
  env: Env,
  payload: unknown,
  createdBy: string,
  notes?: string,
): Promise<CatalogSnapshot> {
  const id = `snap_${newShortId()}`;
  const now = Date.now();
  const version = (payload as CatalogPayload)?.version ?? null;
  await env.DB.prepare(
    `INSERT INTO pricing_snapshots (id, taken_at, catalog_version, payload_json, created_by, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, now, version, JSON.stringify(payload), createdBy, notes ?? null)
    .run();
  return { id, takenAt: now, catalogVersion: version, payload, notes: notes ?? null };
}

export async function listSnapshots(env: Env, limit = 20): Promise<Omit<CatalogSnapshot, 'payload'>[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, taken_at, catalog_version, notes
       FROM pricing_snapshots ORDER BY taken_at DESC LIMIT ?`,
  )
    .bind(limit)
    .all<Record<string, unknown>>();
  return (results ?? []).map((r) => ({
    id: String(r.id),
    takenAt: Number(r.taken_at),
    catalogVersion: (r.catalog_version as string) ?? null,
    notes: (r.notes as string) ?? null,
  }));
}

async function loadSnapshot(env: Env, id: string): Promise<CatalogSnapshot | null> {
  const row = await env.DB.prepare(`SELECT * FROM pricing_snapshots WHERE id = ?`)
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: String(row.id),
    takenAt: Number(row.taken_at),
    catalogVersion: (row.catalog_version as string) ?? null,
    payload: JSON.parse(String(row.payload_json)) as unknown,
    notes: (row.notes as string) ?? null,
  };
}

export interface PriceDiffEntry {
  moduleId: string;
  moduleName: string | null;
  /** null when only present on one side (added / removed module) */
  fromPrice: number | null;
  toPrice: number | null;
  delta: number | null;
  pctChange: number | null;
  options: {
    optionId: string;
    label: string | null;
    fromDelta: number | null;
    toDelta: number | null;
    delta: number | null;
  }[];
}

export interface PriceDiffResult {
  from: { id: string; takenAt: number; catalogVersion: string | null } | null;
  to:
    | { id: string; takenAt: number; catalogVersion: string | null }
    | { id: 'live'; takenAt: number; catalogVersion: string | null };
  changes: PriceDiffEntry[];
}

/** Diff two catalogs. Either side may be a stored snapshot id or, for `to`,
 *  a freshly POSTed live catalog. */
export async function diffSnapshots(
  env: Env,
  fromId: string | null,
  toCatalog: { id: string; takenAt: number; catalogVersion: string | null; payload: CatalogPayload } | null,
): Promise<PriceDiffResult> {
  const snapshots = await listSnapshots(env, 5);
  let fromSnap: CatalogSnapshot | null = null;
  if (fromId) fromSnap = await loadSnapshot(env, fromId);
  else if (snapshots[0]) fromSnap = await loadSnapshot(env, snapshots[0].id);

  let toSnap: { id: string; takenAt: number; catalogVersion: string | null; payload: CatalogPayload } | null = null;
  if (toCatalog) toSnap = toCatalog;
  else if (snapshots[0] && fromSnap && fromSnap.id !== snapshots[0].id) {
    const s = await loadSnapshot(env, snapshots[0].id);
    if (s) toSnap = { id: s.id, takenAt: s.takenAt, catalogVersion: s.catalogVersion, payload: s.payload as CatalogPayload };
  } else if (snapshots[1] && fromSnap?.id === snapshots[0]?.id) {
    // Two-snapshot diff: caller passed no live, default to second-most-recent
    // as `from` and most-recent as `to`.
    const earlier = await loadSnapshot(env, snapshots[1].id);
    if (earlier) {
      const recent = await loadSnapshot(env, snapshots[0].id);
      if (recent) {
        fromSnap = earlier;
        toSnap = { id: recent.id, takenAt: recent.takenAt, catalogVersion: recent.catalogVersion, payload: recent.payload as CatalogPayload };
      }
    }
  }

  const fromMap = indexCatalog((fromSnap?.payload ?? null) as CatalogPayload | null);
  const toMap = indexCatalog((toSnap?.payload ?? null) as CatalogPayload | null);
  const ids = new Set([...fromMap.keys(), ...toMap.keys()]);
  const changes: PriceDiffEntry[] = [];
  for (const id of ids) {
    const f = fromMap.get(id);
    const t = toMap.get(id);
    const fromPrice = f?.basePrice ?? null;
    const toPrice = t?.basePrice ?? null;
    const delta = fromPrice != null && toPrice != null ? toPrice - fromPrice : null;
    const pct = fromPrice != null && toPrice != null && fromPrice !== 0 ? (toPrice - fromPrice) / fromPrice : null;
    const optionIds = new Set([
      ...(f?.options ? Object.keys(f.options) : []),
      ...(t?.options ? Object.keys(t.options) : []),
    ]);
    const options: PriceDiffEntry['options'] = [];
    for (const oid of optionIds) {
      const fo = f?.options?.[oid] ?? null;
      const to = t?.options?.[oid] ?? null;
      const fd = fo?.priceDelta ?? null;
      const td = to?.priceDelta ?? null;
      if (fd === td) continue; // unchanged
      options.push({
        optionId: oid,
        label: to?.label ?? fo?.label ?? null,
        fromDelta: fd,
        toDelta: td,
        delta: fd != null && td != null ? td - fd : null,
      });
    }
    const moduleChanged =
      fromPrice == null ||
      toPrice == null ||
      (delta !== null && delta !== 0) ||
      options.length > 0;
    if (moduleChanged) {
      changes.push({
        moduleId: id,
        moduleName: t?.name ?? f?.name ?? null,
        fromPrice,
        toPrice,
        delta,
        pctChange: pct,
        options,
      });
    }
  }
  changes.sort((a, b) => Math.abs(b.pctChange ?? 0) - Math.abs(a.pctChange ?? 0));
  return {
    from: fromSnap
      ? { id: fromSnap.id, takenAt: fromSnap.takenAt, catalogVersion: fromSnap.catalogVersion }
      : null,
    to: toSnap
      ? { id: toSnap.id as 'live' | string, takenAt: toSnap.takenAt, catalogVersion: toSnap.catalogVersion }
      : { id: 'live', takenAt: Date.now(), catalogVersion: null },
    changes,
  };
}

interface ModuleIndex {
  name: string | null;
  basePrice: number | null;
  options: Record<string, { label: string | null; priceDelta: number | null }>;
}

function indexCatalog(payload: CatalogPayload | null): Map<string, ModuleIndex> {
  const out = new Map<string, ModuleIndex>();
  if (!payload?.modules) return out;
  for (const m of payload.modules) {
    const opts: ModuleIndex['options'] = {};
    for (const o of m.options ?? []) {
      opts[o.id] = { label: o.label ?? null, priceDelta: typeof o.priceDelta === 'number' ? o.priceDelta : null };
    }
    out.set(m.id, {
      name: m.name ?? null,
      basePrice: typeof m.basePrice === 'number' ? m.basePrice : null,
      options: opts,
    });
  }
  return out;
}
