export interface Env {
  // Bindings
  DB: D1Database;
  CACHE: KVNamespace;
  ASSETS: R2Bucket;
  RL_CONTACT: RateLimit;
  RL_CONFIG: RateLimit;
  RL_AUTH: RateLimit;

  // Vars
  ENVIRONMENT: string;
  APP_BASE_URL: string;
  API_BASE_URL: string;
  EMAIL_FROM: string;
  EMAIL_REPLY_TO: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  SESSION_COOKIE_NAME: string;
  SESSION_TTL_DAYS: string;
  MAGIC_LINK_TTL_MIN: string;

  // Secrets
  JWT_SECRET: string;
  RESEND_API_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  ADMIN_API_TOKEN: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;

  // Optional: Cloudflare Browser Rendering binding for server-side PDF
  // generation. When unbound, /api/quotes/:id/pdf returns printable HTML.
  BROWSER?: { fetch: (req: Request) => Promise<Response> };
}

// Cloudflare runtime rate limit binding (typed loosely; types ship with workers-types eventually).
export interface RateLimit {
  limit: (input: { key: string }) => Promise<{ success: boolean }>;
}

export type AppVariables = {
  requestId: string;
  ip: string;
  customer?: { id: string; email: string; jti: string };
  admin?: { tokenHashPrefix: string };
};

export type AppContext = {
  Bindings: Env;
  Variables: AppVariables;
};
