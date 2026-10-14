import "server-only";

import { attemptDeadline, finalizeIfExpired } from "@/lib/quizzes/grading";
import { createAdminClient } from "@/lib/supabase/admin";

const BATCH_LIMIT = 500;

export type CronFinalizeResult = {
  /** In-progress attempts found past their deadline this run. */
  checked: number;
  /** Of those, how many this run actually transitioned (vs. lost a race, or failed to grade). */
  finalized: number;
};

/**
 * Batch counterpart to grading.ts's finalizeIfExpired(): scans every
 * institute for in_progress attempts past their deadline and finalizes
 * each one. Same idempotent, status='in_progress'-guarded update
 * underneath — this only changes *when* a stale attempt gets graded
 * (on a schedule instead of lazily, on next touch), never the grading
 * logic or the RLS deadline enforcement itself, which stays authoritative
 * regardless of whether this ever runs.
 *
 * `BATCH_LIMIT` bounds one sweep; a backlog larger than that drains over
 * subsequent runs rather than risking one unbounded query.
 */
export async function finalizeAllExpiredAttempts(): Promise<CronFinalizeResult> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("quiz_attempts")
    .select("id, status, started_at, duration_seconds, grace_seconds")
    .eq("status", "in_progress")
    .order("started_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    console.error("finalizeAllExpiredAttempts failed to list attempts:", error.message);
    return { checked: 0, finalized: 0 };
  }

  const now = Date.now();
  const expired = (data ?? []).filter(
    (attempt) => attemptDeadline(attempt).getTime() < now,
  );

  const results = await Promise.all(
    expired.map((attempt) => finalizeIfExpired(attempt.id, { actorId: "cron" })),
  );

  return {
    checked: expired.length,
    finalized: results.filter((result) => result?.finalized).length,
  };
}
