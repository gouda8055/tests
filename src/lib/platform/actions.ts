"use server";

import { generateTemporaryPassword } from "@/lib/auth/temp-password";
import { requireRole } from "@/lib/auth/guard";
import { logAudit } from "@/lib/audit/log";
import { getClientIp } from "@/lib/request-ip";
import { createAdminClient } from "@/lib/supabase/admin";
import { RESERVED_SUBDOMAINS } from "@/lib/tenant/reserved-subdomains";
import {
  assignOwnerSchema,
  createInstituteSchema,
  setInstituteStatusSchema,
} from "@/lib/validation/platform";

export type PlatformActionState = { error: string } | { success: string } | undefined;

/**
 * Every action here re-verifies super_admin itself, rather than relying
 * on the /platform page's own guard — a Server Action is an independently
 * invocable endpoint, not something protected just because the page that
 * references it happens to check a role first (SECURITY.md §3: "Check
 * authentication AND authorization on every route handler, server action
 * and API endpoint").
 */

export async function createInstitute(
  _prevState: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  const actor = await requireRole(["super_admin"]);

  const parsed = createInstituteSchema.safeParse({
    name: formData.get("name"),
    subdomain: formData.get("subdomain"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  if (RESERVED_SUBDOMAINS.has(parsed.data.subdomain)) {
    return { error: "That subdomain is reserved." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("institutes")
    .insert({ name: parsed.data.name, subdomain: parsed.data.subdomain })
    .select("id")
    .single();

  if (error) {
    const message =
      error.code === "23505"
        ? "That subdomain is already taken."
        : "Could not create institute.";
    return { error: message };
  }

  await logAudit({
    instituteId: data.id,
    actorId: actor.id,
    action: "institute.created",
    target: data.id,
    metadata: { name: parsed.data.name, subdomain: parsed.data.subdomain },
    ip: await getClientIp(),
  });

  return { success: `Institute "${parsed.data.name}" created.` };
}

export async function assignOwner(
  _prevState: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  const actor = await requireRole(["super_admin"]);

  const parsed = assignOwnerSchema.safeParse({
    instituteId: formData.get("instituteId"),
    email: formData.get("email"),
    fullName: formData.get("fullName"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();

  const { data: institute } = await admin
    .from("institutes")
    .select("id, name")
    .eq("id", parsed.data.instituteId)
    .maybeSingle();

  if (!institute) return { error: "Institute not found." };

  const temporaryPassword = generateTemporaryPassword();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: temporaryPassword,
    email_confirm: true,
  });

  if (createError || !created.user) {
    console.error("assignOwner createUser failed:", createError?.message);
    return { error: "Could not create owner account. The email may already be in use." };
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    institute_id: institute.id,
    role: "institute_owner",
    full_name: parsed.data.fullName,
  });

  if (profileError) {
    console.error(
      "assignOwner profile insert failed, rolling back:",
      profileError.message,
    );
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: "Could not create owner account. Please try again." };
  }

  await logAudit({
    instituteId: institute.id,
    actorId: actor.id,
    action: "institute.owner_assigned",
    target: created.user.id,
    metadata: { email: parsed.data.email },
    ip: await getClientIp(),
  });

  return {
    success: `Owner created for ${institute.name}. Email: ${parsed.data.email} — temporary password: ${temporaryPassword}. Share this with them securely; it will not be shown again.`,
  };
}

export async function setInstituteStatus(
  _prevState: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  const actor = await requireRole(["super_admin"]);

  const parsed = setInstituteStatusSchema.safeParse({
    instituteId: formData.get("instituteId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { error: "Invalid request." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("institutes")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.instituteId)
    .select("id, name")
    .single();

  if (error || !data) return { error: "Could not update institute status." };

  await logAudit({
    instituteId: data.id,
    actorId: actor.id,
    action:
      parsed.data.status === "suspended" ? "institute.suspended" : "institute.activated",
    target: data.id,
    ip: await getClientIp(),
  });

  return { success: `${data.name} is now ${parsed.data.status}.` };
}

/**
 * Single-argument wrapper for direct `<form action={...}>` binding (no
 * useActionState) — the toggle button in institute-status-form.tsx. The
 * result is intentionally discarded; see that component for why.
 */
export async function setInstituteStatusForm(formData: FormData): Promise<void> {
  await setInstituteStatus(undefined, formData);
}
