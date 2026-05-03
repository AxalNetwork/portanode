/**
 * Restrict post-auth redirects to same-origin relative paths to prevent
 * open-redirect / phishing flows. Anything else falls back to `/account/`.
 */
export function safeRedirectPath(input: string | null | undefined, fallback = '/account/'): string {
  if (!input || typeof input !== 'string') return fallback;
  // Disallow protocol-relative ("//evil") and absolute URLs.
  if (input.startsWith('//')) return fallback;
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) return fallback;
  // Disallow CR/LF / control chars (header injection).
  if (/[\r\n\t\0]/.test(input)) return fallback;
  // Must be a single relative path starting with `/`.
  if (!input.startsWith('/')) return fallback;
  return input;
}
