import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Email addresses for notification recipients. profiles has no email
 * column (confirmed via 0002_profiles.sql — it carries institute_id/role/
 * full_name/phone only); the only place an email address lives in this
 * schema is auth.users, so this is a narrow service-role read, same
 * "narrow and justified" precedent as getStudentNames/getProfileNames,
 * just reading a different column off a different table.
 */
export async function getUserEmails(userIds: string[]): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length === 0) return emails;

  const admin = createAdminClient();
  const results = await Promise.all(
    uniqueIds.map(async (id) => {
      const { data, error } = await admin.auth.admin.getUserById(id);
      if (error || !data.user?.email) return null;
      return [id, data.user.email] as const;
    }),
  );

  for (const result of results) {
    if (result) emails.set(result[0], result[1]);
  }
  return emails;
}
