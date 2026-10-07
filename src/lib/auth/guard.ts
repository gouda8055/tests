import "server-only";
import { redirect } from "next/navigation";

import { createServerClient } from "@/lib/supabase/server";
import { getCurrentTenant } from "@/lib/tenant/current";

export type Role = "super_admin" | "institute_owner" | "instructor" | "student";

export type SessionProfile = {
  id: string;
  role: Role;
  instituteId: string | null;
  fullName: string | null;
};

/**
 * Reads the current session's profile, or null if signed out. Uses
 * auth.getUser() rather than auth.getSession() — per Supabase's own
 * guidance, getSession() reads the JWT out of the cookie without
 * re-verifying it with the Auth server, so it must never be trusted for
 * an authorization decision. getUser() does verify it.
 */
export async function getSessionProfile(): Promise<SessionProfile | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, institute_id, full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) return null;

  return {
    id: profile.id,
    role: profile.role as Role,
    instituteId: profile.institute_id,
    fullName: profile.full_name,
  };
}

/**
 * Requires an authenticated session whose role is one of `allowedRoles`.
 * Redirects to /sign-in otherwise. This is the server-side enforcement
 * SECURITY.md §3 requires on every route — never rely on UI hiding alone.
 */
export async function requireRole(allowedRoles: Role[]): Promise<SessionProfile> {
  const profile = await getSessionProfile();
  if (!profile || !allowedRoles.includes(profile.role)) {
    redirect("/sign-in");
  }
  return profile;
}

/**
 * Like requireRole, but also requires the session's own institute to
 * match the tenant resolved for the current request (proxy.ts). Without
 * this, a user could be served /admin or /student chrome branded for a
 * different institute than the one their data actually belongs to — RLS
 * alone still prevents real data leakage (it scopes by the user's own
 * institute_id, not the subdomain), but this check keeps the UI/URL
 * context honest and is the IDOR-style belt-and-suspenders SECURITY.md
 * §3 asks for ("verify it belongs to the user's institute").
 */
export async function requireTenantRole(allowedRoles: Role[]): Promise<SessionProfile> {
  const profile = await requireRole(allowedRoles);
  const tenant = await getCurrentTenant();

  if (!tenant || profile.instituteId !== tenant.id) {
    redirect("/sign-in");
  }

  return profile;
}
