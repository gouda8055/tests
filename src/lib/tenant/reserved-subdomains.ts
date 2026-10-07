// Kept in sync with the institutes_subdomain_not_reserved check constraint
// in supabase/migrations/0001_institutes.sql. SECURITY.md §8: "Reserve
// and block subdomains."
export const RESERVED_SUBDOMAINS = new Set([
  "admin",
  "api",
  "www",
  "app",
  "login",
  "auth",
  "support",
  "mail",
  "static",
  "billing",
  "security",
]);

// Mirrors the institutes_subdomain_format check constraint: lowercase
// letters/digits, single hyphens, no leading/trailing/doubled hyphen.
const SUBDOMAIN_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSubdomainFormat(subdomain: string): boolean {
  return SUBDOMAIN_FORMAT.test(subdomain);
}
