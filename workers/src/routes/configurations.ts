import { Hono } from 'hono';
import type { AppContext } from '../env';
import { Errors } from '../lib/errors';
import { rateLimit } from '../middleware/rate-limit';
import { turnstile } from '../middleware/turnstile';
import {
  ConfigurationInput,
  createConfiguration,
  getConfiguration,
} from '../services/configurations';

export const configurations = new Hono<AppContext>();

configurations.post(
  '/',
  rateLimit((env) => env.RL_CONFIG),
  turnstile,
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ConfigurationInput.safeParse(body);
    if (!parsed.success) throw Errors.invalid(parsed.error.flatten());
    const customer = c.get('customer');
    const row = await createConfiguration(c.env, parsed.data, customer?.id ?? null, {
      requestId: c.get('requestId'),
      ip: c.get('ip'),
    });
    return c.json({ data: row }, 201);
  },
);

configurations.get('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await getConfiguration(c.env, id);
  if (!row) throw Errors.notFound('Configuration not found');
  // Anonymous configs are public-read by id; owned ones require ownership.
  const customer = c.get('customer');
  if (row.customerId && row.customerId !== customer?.id) throw Errors.forbidden();
  return c.json({ data: row });
});
