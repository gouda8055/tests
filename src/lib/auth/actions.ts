"use server";

import { redirect } from "next/navigation";

import { logAudit } from "@/lib/audit/log";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { getCurrentTenant } from "@/lib/tenant/current";
import {
  sendPhoneOtpSchema,
  signInSchema,
  signUpSchema,
  verifyPhoneOtpSchema,
} from "@/lib/validation/auth";

export type ActionState = { error: string } | undefined;

const GENERIC_SIGNUP_ERROR = "Could not create your account. Please try again.";
const GENERIC_SIGNIN_ERROR = "Invalid email or password.";
const GENERIC_RATE_LIMIT_ERROR = "Too many attempts. Please try again later.";

/**
 * Sign-up is only ever tenant-scoped: institute_id comes from the
 * server-resolved tenant (proxy.ts → getCurrentTenant()), never from the
 * client, and every new signup is a `student` — there is no self-serve
 * way to become an instructor or owner (SECURITY.md §1).
 */
export async function signUp(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return { error: "Sign up from your institute's own page, not this one." };
  }

  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    fullName: formData.get("fullName"),
    phone: formData.get("phone"),
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ?? "Please check your details and try again.",
    };
  }

  const allowed = await checkRateLimit("signup", 5, 3600);
  if (!allowed) return { error: GENERIC_RATE_LIMIT_ERROR };

  const ip = await getClientIp();
  const admin = createAdminClient();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    console.error("Signup createUser failed:", createError?.message);
    return { error: GENERIC_SIGNUP_ERROR };
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    institute_id: tenant.id,
    role: "student",
    full_name: parsed.data.fullName,
    phone: parsed.data.phone ?? null,
  });

  if (profileError) {
    // Roll back the orphaned auth user rather than leave an account with
    // no profile (every role/tenant check would then fail for them).
    console.error(
      "Signup profile insert failed, rolling back auth user:",
      profileError.message,
    );
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: GENERIC_SIGNUP_ERROR };
  }

  await logAudit({
    instituteId: tenant.id,
    actorId: created.user.id,
    action: "auth.signup",
    ip,
  });

  // Establish the session via the cookie-aware server client (not the
  // admin client, which has no session concept) so the browser is
  // actually signed in after this action returns.
  const supabase = await createServerClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (signInError) {
    // Account exists and is usable — just couldn't auto-sign-in. Send
    // them to sign in manually rather than surfacing an internal error.
    redirect("/sign-in");
  }

  redirect("/student");
}

export async function signIn(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Enter a valid email and password.",
    };
  }

  const allowed = await checkRateLimit("login", 10, 900);
  if (!allowed) return { error: GENERIC_RATE_LIMIT_ERROR };

  const ip = await getClientIp();
  const tenant = await getCurrentTenant();
  const supabase = await createServerClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    await logAudit({
      instituteId: tenant?.id ?? null,
      actorId: null,
      action: "auth.login_failed",
      metadata: { email: parsed.data.email },
      ip,
    });
    return { error: GENERIC_SIGNIN_ERROR };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, institute_id")
    .eq("id", data.user.id)
    .maybeSingle();

  await logAudit({
    instituteId: tenant?.id ?? null,
    actorId: data.user.id,
    action: "auth.login_success",
    ip,
  });

  if (profile?.role === "super_admin") {
    redirect("/platform");
  }

  if (
    profile?.role === "institute_owner" ||
    profile?.role === "instructor" ||
    profile?.role === "student"
  ) {
    // RLS already prevents any real cross-tenant data access regardless
    // of which subdomain they logged in on (every query is scoped by
    // their own institute_id, not the request host) — this check exists
    // purely so a mismatch gets a clear error here instead of a silent
    // bounce from requireTenantRole on the destination page.
    if (!tenant || profile.institute_id !== tenant.id) {
      await supabase.auth.signOut();
      return { error: "This account isn't registered for this institute." };
    }
    redirect(profile.role === "student" ? "/student" : "/admin");
  }

  // No profile row — shouldn't happen, but never leave them signed in
  // with nowhere valid to go.
  await supabase.auth.signOut();
  return { error: "Account setup incomplete. Contact support." };
}

export async function signOut(): Promise<void> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  await supabase.auth.signOut();

  if (user) {
    await logAudit({
      instituteId: null,
      actorId: user.id,
      action: "auth.signout",
      ip: await getClientIp(),
    });
  }

  redirect("/");
}

/**
 * Phone OTP: fully wired and rate-limited per SECURITY.md §3, but there
 * is no SMS provider configured on this Supabase project yet, so
 * signInWithOtp will error until one is. Not surfaced in the sign-in UI
 * until then — see README. Kept here so enabling it later is a one-line
 * UI change, not new server logic.
 */
export async function sendPhoneOtp(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = sendPhoneOtpSchema.safeParse({ phone: formData.get("phone") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a valid phone number." };
  }

  const ipAllowed = await checkRateLimit("otp-send-ip", 10, 3600);
  const phoneAllowed = await checkRateLimit("otp-send-phone", 3, 3600, parsed.data.phone);
  if (!ipAllowed || !phoneAllowed) return { error: GENERIC_RATE_LIMIT_ERROR };

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithOtp({ phone: parsed.data.phone });

  if (error) {
    console.error("OTP send failed:", error.message);
    return { error: "SMS sign-in isn't available yet. Use email and password instead." };
  }

  return undefined;
}

export async function verifyPhoneOtp(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = verifyPhoneOtpSchema.safeParse({
    phone: formData.get("phone"),
    token: formData.get("token"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a valid code." };
  }

  const allowed = await checkRateLimit("otp-verify", 10, 900, parsed.data.phone);
  if (!allowed) return { error: GENERIC_RATE_LIMIT_ERROR };

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.verifyOtp({
    phone: parsed.data.phone,
    token: parsed.data.token,
    type: "sms",
  });

  if (error || !data.user) {
    return { error: "Incorrect or expired code." };
  }

  const tenant = await getCurrentTenant();
  await logAudit({
    instituteId: tenant?.id ?? null,
    actorId: data.user.id,
    action: "auth.login_success",
    metadata: { method: "phone_otp" },
    ip: await getClientIp(),
  });

  redirect("/student");
}
