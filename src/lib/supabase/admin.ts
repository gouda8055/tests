import "server-only";
import { createClient } from "@supabase/supabase-js";

import { serverEnv } from "@/lib/env.server";

/**
 * Service-role client. Bypasses RLS entirely — see SECURITY.md §2.
 *
 * Only import this from server-only code that has a specific, narrow
 * reason RLS can't do the job (e.g. resolving a tenant for a visitor who
 * isn't a member of it yet). Never use it as a shortcut around writing a
 * proper RLS policy for an authenticated user's own data.
 */
export function createAdminClient() {
  return createClient(
    serverEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}
