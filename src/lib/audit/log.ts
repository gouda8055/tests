import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type AuditEntry = {
  instituteId: string | null;
  actorId: string | null;
  action: string;
  target?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
};

/**
 * Writes one append-only audit_logs row (SECURITY.md §10). Uses the
 * service-role client for every entry, including ones an authenticated
 * caller's own RLS policy could technically satisfy — this keeps audit
 * writes on a single code path, and is safe because every field here is
 * server-determined (the verified session's user id, the server-resolved
 * tenant), never taken from raw client input.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase.from("audit_logs").insert({
    institute_id: entry.instituteId,
    actor_id: entry.actorId,
    action: entry.action,
    target: entry.target ?? null,
    metadata: entry.metadata ?? {},
    ip: entry.ip ?? null,
  });

  if (error) {
    // Never let an audit-log failure block the user-facing action it's
    // attached to — log loudly server-side instead.
    console.error("Failed to write audit log entry:", entry.action, error.message);
  }
}
