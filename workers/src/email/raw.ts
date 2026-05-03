import type { Env } from '../env';
import { logEvent } from '../db/events';
import { log } from '../lib/log';

// `sendEmail` (./send) renders pre-registered customer templates. Internal
// ops digests don't fit that template registry — they are operator-only,
// frequently change, and never see a customer — so we have a small raw
// sender that takes already-rendered HTML and text. Audit logging still
// flows through the events table.

export interface RawEmailArgs {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export async function sendRawEmail(
  env: Env,
  args: RawEmailArgs,
  meta: { requestId?: string; subjectKind?: string; subjectId?: string } = {},
) {
  const to = Array.isArray(args.to) ? args.to : [args.to];
  const payload = {
    from: env.EMAIL_FROM,
    to,
    subject: args.subject,
    html: args.html,
    text: args.text,
    reply_to: args.replyTo ?? env.EMAIL_REPLY_TO,
  };
  let providerId: string | null = null;
  let status: 'sent' | 'failed' = 'sent';
  let errorMsg: string | undefined;
  try {
    if (!env.RESEND_API_KEY || env.ENVIRONMENT === 'development') {
      log.info({ msg: 'email.raw.dryrun', to, subject: args.subject });
    } else {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        status = 'failed';
        errorMsg = `resend ${res.status}`;
      } else {
        const data = (await res.json()) as { id?: string };
        providerId = data.id ?? null;
      }
    }
  } catch (err) {
    status = 'failed';
    errorMsg = err instanceof Error ? err.message : 'unknown';
  }
  await logEvent(env.DB, {
    type: status === 'sent' ? 'email.sent' : 'email.failed',
    actorKind: 'system',
    subjectKind: meta.subjectKind ?? 'email',
    subjectId: meta.subjectId ?? providerId ?? null,
    requestId: meta.requestId ?? null,
    payload: { to, subject: args.subject, providerId, error: errorMsg, raw: true },
  });
  return { status, providerId };
}
