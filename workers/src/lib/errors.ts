import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class ApiError extends Error {
  status: ContentfulStatusCode;
  code: string;
  details?: unknown;
  constructor(status: ContentfulStatusCode, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const Errors = {
  badRequest: (msg = 'Bad request', details?: unknown) =>
    new ApiError(400, 'bad_request', msg, details),
  unauthorized: (msg = 'Authentication required') =>
    new ApiError(401, 'unauthorized', msg),
  forbidden: (msg = 'Forbidden') => new ApiError(403, 'forbidden', msg),
  notFound: (msg = 'Not found') => new ApiError(404, 'not_found', msg),
  conflict: (msg = 'Conflict') => new ApiError(409, 'conflict', msg),
  rateLimited: (msg = 'Too many requests') =>
    new ApiError(429, 'rate_limited', msg),
  invalid: (details: unknown, msg = 'Validation failed') =>
    new ApiError(422, 'validation_failed', msg, details),
  internal: (msg = 'Internal error') => new ApiError(500, 'internal', msg),
};

export function errorEnvelope(
  err: ApiError,
  requestId: string,
): { error: { code: string; message: string; details?: unknown; requestId: string } } {
  return {
    error: {
      code: err.code,
      message: err.message,
      details: err.details,
      requestId,
    },
  };
}

export function jsonError(c: Context, err: ApiError) {
  return c.json(
    errorEnvelope(err, c.get('requestId') ?? 'unknown'),
    err.status,
  );
}
