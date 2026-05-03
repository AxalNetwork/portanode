import type { MiddlewareHandler } from 'hono';
import type { AppContext } from '../env';
import { newShortId } from '../lib/ids';
import { log } from '../lib/log';

export const requestContext: MiddlewareHandler<AppContext> = async (c, next) => {
  const requestId = c.req.header('cf-request-id') ?? c.req.header('x-request-id') ?? newShortId();
  const ip =
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  c.set('requestId', requestId);
  c.set('ip', ip);
  c.header('x-request-id', requestId);

  const start = Date.now();
  try {
    await next();
  } finally {
    log.info({
      requestId,
      msg: 'request',
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durMs: Date.now() - start,
      ip,
    });
  }
};
