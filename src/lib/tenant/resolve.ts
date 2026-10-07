import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { extractSubdomain } from "@/lib/tenant/host";
import {
  isValidSubdomainFormat,
  RESERVED_SUBDOMAINS,
} from "@/lib/tenant/reserved-subdomains";

export type TenantInstitute = {
  id: string;
  name: string;
  subdomain: string;
  status: "active" | "suspended";
};

export type TenantResolution =
  | { kind: "no-tenant" }
  | { kind: "invalid" }
  | { kind: "not-found" }
  | { kind: "suspended"; institute: TenantInstitute }
  | { kind: "active"; institute: TenantInstitute };

/**
 * Resolves the tenant for a request host. Always looks the institute up
 * server-side (service role — see src/lib/supabase/admin.ts for why) so
 * the result reflects the database's current status, never a
 * client-supplied value. SECURITY.md: "Resolve the tenant from the host
 * on the server, and never trust a client-supplied tenant header."
 */
export async function resolveTenantFromHost(
  host: string | null,
  appDomain: string,
): Promise<TenantResolution> {
  if (!host) return { kind: "no-tenant" };

  const subdomain = extractSubdomain(host, appDomain);

  if (subdomain === null) return { kind: "no-tenant" };
  if (subdomain === "" || !isValidSubdomainFormat(subdomain)) return { kind: "invalid" };
  if (RESERVED_SUBDOMAINS.has(subdomain)) return { kind: "invalid" };

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("institutes")
    .select("id, name, subdomain, status")
    .eq("subdomain", subdomain)
    .maybeSingle();

  if (error) {
    // Fail closed: never treat a lookup failure as "no tenant" (which
    // would fall through to unscoped content) or guess "active".
    throw new Error(
      `Tenant lookup failed for subdomain "${subdomain}": ${error.message}`,
    );
  }

  if (!data) return { kind: "not-found" };

  const institute: TenantInstitute = {
    id: data.id,
    name: data.name,
    subdomain: data.subdomain,
    status: data.status === "suspended" ? "suspended" : "active",
  };

  return institute.status === "suspended"
    ? { kind: "suspended", institute }
    : { kind: "active", institute };
}
