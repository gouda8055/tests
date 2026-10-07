import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env";
import { resolveTenantFromHost } from "@/lib/tenant/resolve";
import { TENANT_ID_HEADER, TENANT_SUBDOMAIN_HEADER } from "@/lib/tenant/current";

export const config = {
  matcher: [
    // Skip Next's internals and common static file extensions — no tenant
    // lookup needed for them, and it keeps every request from hitting the
    // database (SECURITY.md §5 rate limiting is for expensive endpoints;
    // this is the same principle applied to a lookup that runs on every
    // request).
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)",
  ],
};

export async function proxy(request: NextRequest) {
  const resolution = await resolveTenantFromHost(
    request.headers.get("host"),
    publicEnv.NEXT_PUBLIC_APP_DOMAIN,
  );

  if (resolution.kind === "invalid" || resolution.kind === "not-found") {
    return new NextResponse("Not found.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  if (resolution.kind === "suspended") {
    return new NextResponse("This institute's account is currently unavailable.", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // Always strip first, then set explicitly only for an active tenant —
  // a request never reaches a page with a tenant header we didn't just
  // set ourselves. This is what makes it safe for downstream code to
  // trust these headers as server-verified rather than client input
  // (SECURITY.md: "never trust a client-supplied tenant header").
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(TENANT_ID_HEADER);
  requestHeaders.delete(TENANT_SUBDOMAIN_HEADER);

  if (resolution.kind === "active") {
    requestHeaders.set(TENANT_ID_HEADER, resolution.institute.id);
    requestHeaders.set(TENANT_SUBDOMAIN_HEADER, resolution.institute.subdomain);
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  // Refresh the Supabase session on every request. Only Server Actions and
  // Route Handlers can write cookies — a Server Component can't — so
  // without this, a token that expires mid-session would only get
  // refreshed the next time a form action happens to run. No `domain` is
  // set (Supabase's default), keeping the cookies host-only: a session on
  // one tenant subdomain never reaches another (SECURITY.md §3).
  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  await supabase.auth.getUser();

  return response;
}
