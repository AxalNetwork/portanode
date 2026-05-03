import { Hono } from 'hono';
import type { AppContext } from '../env';
import { Errors } from '../lib/errors';
import { rateLimit } from '../middleware/rate-limit';
import { turnstile } from '../middleware/turnstile';
import {
  ContactInput,
  LeasingInput,
  SpecDownloadInput,
  createLead,
} from '../services/leads';
import { sendEmail } from '../email/send';

export const leads = new Hono<AppContext>();

leads.post(
  '/contact',
  rateLimit((env) => env.RL_CONTACT),
  turnstile,
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ContactInput.safeParse(body);
    if (!parsed.success) throw Errors.invalid(parsed.error.flatten());
    const lead = await createLead(c.env, 'contact', parsed.data, {
      requestId: c.get('requestId'),
      ip: c.get('ip'),
      userAgent: c.req.header('user-agent') ?? undefined,
    });
    await sendEmail(
      c.env,
      {
        to: parsed.data.email,
        template: 'contact-received',
        subject: 'We received your message',
        vars: { name: parsed.data.name, leadId: lead.id },
      },
      { requestId: c.get('requestId'), subjectKind: 'lead', subjectId: lead.id },
    );
    return c.json({ data: { id: lead.id } }, 201);
  },
);

leads.post(
  '/leasing',
  rateLimit((env) => env.RL_CONTACT),
  turnstile,
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = LeasingInput.safeParse(body);
    if (!parsed.success) throw Errors.invalid(parsed.error.flatten());
    const lead = await createLead(c.env, 'leasing', parsed.data, {
      requestId: c.get('requestId'),
      ip: c.get('ip'),
      userAgent: c.req.header('user-agent') ?? undefined,
    });
    await sendEmail(
      c.env,
      {
        to: parsed.data.email,
        template: 'leasing-received',
        subject: 'Leasing inquiry received',
        vars: { name: parsed.data.name, region: parsed.data.region, leadId: lead.id },
      },
      { requestId: c.get('requestId'), subjectKind: 'lead', subjectId: lead.id },
    );
    return c.json({ data: { id: lead.id } }, 201);
  },
);

leads.post(
  '/spec-download',
  rateLimit((env) => env.RL_CONTACT),
  turnstile,
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = SpecDownloadInput.safeParse(body);
    if (!parsed.success) throw Errors.invalid(parsed.error.flatten());
    const lead = await createLead(c.env, 'spec_download', parsed.data, {
      requestId: c.get('requestId'),
      ip: c.get('ip'),
      userAgent: c.req.header('user-agent') ?? undefined,
    });
    const downloadUrl = `${c.env.APP_BASE_URL}/specs/${encodeURIComponent(parsed.data.assetId)}.pdf`;
    await sendEmail(
      c.env,
      {
        to: parsed.data.email,
        template: 'spec-download',
        subject: 'Your AXAL spec sheet',
        vars: { assetTitle: parsed.data.assetId, downloadUrl, leadId: lead.id },
      },
      { requestId: c.get('requestId'), subjectKind: 'lead', subjectId: lead.id },
    );
    return c.json({ data: { id: lead.id, downloadUrl } }, 201);
  },
);
