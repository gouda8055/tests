import "server-only";
import { headers } from "next/headers";
import { cache } from "react";

import { createAdminClient } from "@/lib/supabase/admin";

export const TENANT_ID_HEADER = "x-tenant-id";
export const TENANT_SUBDOMAIN_HEADER = "x-tenant-subdomain";

export type CurrentTenant = {
  id: string;
  subdomain: string;
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
};

/**
 * Reads the tenant resolved by middleware.ts for the current request.
 * middleware.ts always strips any client-supplied x-tenant-id before
 * setting its own, so this header is server-verified, not client input.
 *
 * Fetches the full branding row via the admin client (not the user's own
 * session client) because this must also work for an anonymous visitor
 * who isn't a member of the institute yet — see resolve.ts for the same
 * reasoning. cache() dedupes this to one query per request even when
 * called from multiple places (layout + page).
 */
export const getCurrentTenant = cache(async (): Promise<CurrentTenant | null> => {
  const headerList = await headers();
  const id = headerList.get(TENANT_ID_HEADER);
  if (!id) return null;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("institutes")
    .select("id, name, subdomain, logo_url, primary_color")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    subdomain: data.subdomain,
    name: data.name,
    logoUrl: data.logo_url,
    primaryColor: data.primary_color,
  };
});
