import type { MiddlewareHandler } from 'hono';
import type { AppContext } from '../env';
import { Errors } from '../lib/errors';
import { log } from '../lib/log';
import type { RateLimit } from '../env';

/**
 * Rate-limit middleware backed by a Cloudflare unsafe ratelimit binding.
 *
 * Behavior:
 * - Limiter unbound (e.g. local dev without the `unsafe` namespace): fail
 *   open, log a warning. The Wrangler `unsafe` bindings only exist in the
 *   Cloudflare runtime — local `wrangler dev` may not provide them.
 * - Limiter present and returns `success=false`: throw 429.
 * - Limiter throws unexpectedly: in `development` fail open with a warning,
 *   in any other environment (`staging`/`production`) fail **closed** so a
 *   broken limiter does not silently disable abuse controls.
 */
export function rateLimit(
  picker: (env: AppContext['Bindings']) => RateLimit,
): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    const limiter = picker(c.env);
    const ip = c.get('ip') ?? 'unknown';
    const key = `${ip}:${c.req.path}`;

    if (!limiter || typeof limiter.limit !== 'function') {
      const dev = c.env.ENVIRONMENT === 'development';
      log.warn({
        requestId: c.get('requestId'),
        msg: 'ratelimit.binding_missing',
        path: c.req.path,
        failClosed: !dev,
      });
      if (!dev) throw Errors.rateLimited('Rate limiter unavailable');
      return next();
    }

    let success = true;
    try {
      const res = await limiter.limit({ key });
      success = res.success;
    } catch (err) {
      const dev = c.env.ENVIRONMENT === 'development';
      log.error({
        requestId: c.get('requestId'),
        msg: 'ratelimit.error',
        path: c.req.path,
        failClosed: !dev,
        err: err instanceof Error ? err.message : String(err),
      });
      if (!dev) throw Errors.rateLimited('Rate limiter unavailable');
      return next();
    }
    if (!success) throw Errors.rateLimited();
    return next();
  };
}
