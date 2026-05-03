import type { D1Database } from '@cloudflare/workers-types';
import { newEventId } from '../lib/ids';

export interface EventInput {
  type: string;
  actorKind: 'system' | 'customer' | 'admin' | 'stripe' | 'resend';
  actorId?: string | null;
  subjectKind?: string | null;
  subjectId?: string | null;
  requestId?: string | null;
  ip?: string | null;
  payload?: unknown;
}

export async function logEvent(db: D1Database, e: EventInput): Promise<void> {
  const id = newEventId();
  const ts = Date.now();
  await db
    .prepare(
      `INSERT INTO events (id, ts, actor_kind, actor_id, type, subject_kind, subject_id, request_id, ip, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      ts,
      e.actorKind,
      e.actorId ?? null,
      e.type,
      e.subjectKind ?? null,
      e.subjectId ?? null,
      e.requestId ?? null,
      e.ip ?? null,
      e.payload ? JSON.stringify(e.payload) : null,
    )
    .run();
}
