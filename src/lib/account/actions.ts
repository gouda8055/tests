"use server";

import { refresh } from "next/cache";

import { requireRole } from "@/lib/auth/guard";
import { logAudit } from "@/lib/audit/log";
import { formField } from "@/lib/form-data";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { createServerClient } from "@/lib/supabase/server";
import { changePasswordSchema, updateFullNameSchema } from "@/lib/validation/account";

export type AccountActionState = { error: string } | { success: string } | undefined;

/**
 * Any signed-in role may update their own display name — profiles'
 * `profiles_update_self` RLS policy (0005) already allows this; role and
 * institute_id stay trigger-enforced immutable regardless of what's sent.
 */
export async function updateFullName(
  _prevState: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const actor = await requireRole(["institute_owner", "instructor", "student"]);

  const parsed = updateFullNameSchema.safeParse({
    fullName: formField(formData, "fullName"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createServerClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName })
    .eq("id", actor.id);
  if (error) return { error: "Could not update your name." };

  await logAudit({
    instituteId: actor.instituteId,
    actorId: actor.id,
    action: "profile.name_updated",
    target: actor.id,
    ip: await getClientIp(),
  });

  refresh();
  return { success: "Name updated." };
}

/** Against the already-authenticated session — no extra Supabase config needed. */
export async function changePassword(
  _prevState: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const actor = await requireRole(["institute_owner", "instructor", "student"]);

  const parsed = changePasswordSchema.safeParse({
    password: formField(formData, "password"),
    confirmPassword: formField(formData, "confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const allowed = await checkRateLimit("account.password-change", 5, 3600, actor.id);
  if (!allowed) return { error: "Too many attempts. Try again later." };

  const supabase = await createServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "Could not update your password." };

  await logAudit({
    instituteId: actor.instituteId,
    actorId: actor.id,
    action: "profile.password_changed",
    target: actor.id,
    ip: await getClientIp(),
  });

  return { success: "Password updated." };
}
