import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Display names for the audit log viewer (institute_owner only — see
 * audit_logs_select_super_admin_or_owner in 0005_rls_policies.sql). Unlike
 * getStudentNames (src/lib/courses/student-names.ts), an audit log's
 * actor can be any role in the institute, so this doesn't filter by
 * role='student'. Narrow service-role read for the same reason as that
 * helper: profiles' RLS only lets a user read their own row.
 */
export async function getProfileNames(
  instituteId: string,
  profileIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const uniqueIds = [...new Set(profileIds)];
  if (uniqueIds.length === 0) return names;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("institute_id", instituteId)
    .in("id", uniqueIds);

  if (error) {
    console.error("getProfileNames failed:", error.message);
    return names;
  }

  for (const row of data ?? []) {
    names.set(row.id as string, (row.full_name as string | null) ?? "Unnamed");
  }
  return names;
}
