import type { Env } from '../env';
import { logEvent } from '../db/events';
import { templates, renderTemplate, type TemplateName } from './templates';
import { log } from '../lib/log';

export interface SendArgs {
  to: string | string[];
  template: TemplateName;
  vars: Record<string, unknown>;
  subject: string;
  replyTo?: string;
}

export interface SendMeta {
  requestId?: string;
  subjectKind?: string;
  subjectId?: string;
  actorKind?: 'system' | 'admin' | 'customer';
  actorId?: string | null;
}

export async function sendEmail(env: Env, args: SendArgs, meta: SendMeta = {}) {
  if (!templates[args.template]) {
    throw new Error(`Unknown email template: ${args.template}`);
  }
  const html = renderTemplate(args.template, args.vars);
  const text = stripHtml(html);
  const to = Array.isArray(args.to) ? args.to : [args.to];

  const payload = {
    from: env.EMAIL_FROM,
    to,
    subject: args.subject,
    html,
    text,
    reply_to: args.replyTo ?? env.EMAIL_REPLY_TO,
  };

  let providerId: string | null = null;
  let status: 'sent' | 'failed' = 'sent';
  let errorMsg: string | undefined;

  try {
    if (!env.RESEND_API_KEY || env.ENVIRONMENT === 'development') {
      // Dev mode / no key: log and continue without making outbound calls.
      log.info({
        requestId: meta.requestId,
        msg: 'email.dryrun',
        template: args.template,
        to,
        subject: args.subject,
      });
    } else {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${env.RESEND_API_KEY}`,
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
    actorKind: meta.actorKind ?? 'system',
    actorId: meta.actorId ?? null,
    subjectKind: meta.subjectKind ?? 'email',
    subjectId: meta.subjectId ?? providerId ?? null,
    requestId: meta.requestId ?? null,
    payload: {
      template: args.template,
      to,
      subject: args.subject,
      providerId,
      error: errorMsg,
    },
  });

  if (status === 'failed') {
    log.error({
      requestId: meta.requestId,
      msg: 'email.failed',
      template: args.template,
      err: errorMsg,
    });
  }
  return { status, providerId };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
