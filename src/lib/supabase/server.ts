import "server-only";
import { createServerClient as createSupabaseServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { publicEnv } from "@/lib/env";

/**
 * Session-bound client for Server Components, Server Actions and Route
 * Handlers — uses the signed-in user's own cookies, so RLS applies
 * normally. No `domain` is set on the cookies (Supabase's default),
 * which makes them host-only: a session on acme.yourapp.com never
 * reaches other.yourapp.com or the base domain. SECURITY.md §3: "Use
 * host-only cookies. Never set session cookies on the parent domain."
 * Do not add a shared `domain` here.
 */
export async function createServerClient() {
  const cookieStore = await cookies();

  return createSupabaseServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component, where cookies() is read-only.
            // Safe to ignore: proxy.ts refreshes the session on every
            // request, so an expired token is refreshed on the next
            // navigation regardless.
          }
        },
      },
    },
  );
}
