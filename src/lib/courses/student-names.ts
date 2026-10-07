import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Display names for students on staff-only screens (roster, attempts).
 *
 * Narrow service-role read: profiles' RLS (0005) only lets a user read
 * their own row, so institute staff can't read their students' names
 * through the session client. Callers pass student IDs they already
 * obtained through an RLS-scoped read (enrollments / quiz_attempts), and
 * this re-scopes to the caller's own institute and selects only
 * id + full_name — never phone or any other personal data (SECURITY.md §9).
 */
export async function getStudentNames(
  instituteId: string,
  studentIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const uniqueIds = [...new Set(studentIds)];
  if (uniqueIds.length === 0) return names;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("institute_id", instituteId)
    .eq("role", "student")
    .in("id", uniqueIds);

  if (error) {
    console.error("getStudentNames failed:", error.message);
    return names;
  }

  for (const row of data ?? []) {
    names.set(row.id as string, (row.full_name as string | null) ?? "Unnamed student");
  }
  return names;
}
