import type { ErrorHandler } from 'hono';
import { ApiError, Errors, errorEnvelope } from '../lib/errors';
import { log } from '../lib/log';
import type { AppContext } from '../env';

export const errorHandler: ErrorHandler<AppContext> = (err, c) => {
  const requestId = c.get('requestId') ?? 'unknown';
  if (err instanceof ApiError) {
    if (err.status >= 500) {
      log.error({ requestId, msg: 'api_error', code: err.code, status: err.status, err: err.message });
    } else {
      log.warn({ requestId, msg: 'api_error', code: err.code, status: err.status });
    }
    return c.json(errorEnvelope(err, requestId), err.status);
  }
  log.error({
    requestId,
    msg: 'unhandled_error',
    err: err.message,
    stack: err.stack,
  });
  const internal = Errors.internal();
  return c.json(errorEnvelope(internal, requestId), 500);
};

export const notFoundHandler = (c: import('hono').Context<AppContext>) => {
  return c.json(errorEnvelope(Errors.notFound(`No route for ${c.req.method} ${c.req.path}`), c.get('requestId') ?? 'unknown'), 404);
};
