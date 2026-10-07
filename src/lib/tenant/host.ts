/**
 * Pure host-parsing logic, kept free of any import that needs secrets
 * (createAdminClient/env.server) so it can be unit tested without a
 * Supabase connection.
 */

/**
 * Extracts the single-label subdomain from a request Host header, given
 * the app's base domain. Returns:
 * - null: the host IS the base domain (or isn't under it at all — e.g. a
 *   stray request with a mismatched Host header) — no tenant to resolve.
 * - "": the host is under the base domain but with a malformed prefix
 *   (multiple labels, e.g. "a.b.yourapp.com") — never silently take the
 *   first label.
 * - otherwise: the candidate subdomain, still unvalidated against format
 *   and reserved-name rules.
 */
export function extractSubdomain(host: string, appDomain: string): string | null {
  const hostname = (host.split(":")[0] ?? "").toLowerCase();
  const baseDomain = appDomain.toLowerCase();

  if (hostname === "" || hostname === baseDomain) return null;
  if (!hostname.endsWith(`.${baseDomain}`)) return null;

  const prefix = hostname.slice(0, -(baseDomain.length + 1));
  if (prefix === "" || prefix.includes(".")) return "";

  return prefix;
}
