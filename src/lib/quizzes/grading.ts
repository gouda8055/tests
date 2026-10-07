import "server-only";

import { logAudit } from "@/lib/audit/log";
import { getClientIp } from "@/lib/request-ip";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Quiz grading and lazy finalization.
 *
 * This module is deliberately `server-only` and NOT `"use server"`: none of
 * these functions may become client-invocable endpoints. Callers (server
 * actions and server components) must authorize the caller against the
 * attempt through an RLS-scoped read before calling in.
 *
 * Service-role use here is the one narrow, documented bypass for Stage 2
 * (same precedent as Stage 1's signup profile insert):
 *  - quiz_answer_keys has no student select policy (SECURITY.md §4), so
 *    grading must read it with the service-role client;
 *  - status/score/max_score/submitted_at on quiz_attempts are written ONLY
 *    from finalizeIfExpired() below, never from the student's own session,
 *    so a student can never write their own score.
 */

export type AttemptStatus = "in_progress" | "submitted" | "timed_out";

export type FinalizeResult = {
  status: AttemptStatus;
  /** True only if this call is the one that transitioned the attempt. */
  finalized: boolean;
};

type AttemptRow = {
  id: string;
  institute_id: string;
  quiz_id: string;
  student_id: string;
  status: AttemptStatus;
  started_at: string;
  duration_seconds: number;
  grace_seconds: number;
  question_order: unknown;
};

/** started_at + duration + grace — the same deadline 0017's RLS enforces. */
export function attemptDeadline(attempt: {
  started_at: string;
  duration_seconds: number;
  grace_seconds: number;
}): Date {
  return new Date(
    new Date(attempt.started_at).getTime() +
      (attempt.duration_seconds + attempt.grace_seconds) * 1000,
  );
}

/**
 * List-page helper: lazily finalizes every attempt in `attempts` that is
 * still in_progress but past its deadline. Returns true if any changed, so
 * the caller knows to re-read. Callers pass attempts they already read
 * through an RLS-scoped query.
 */
export async function finalizeExpiredAttempts(
  attempts: {
    id: string;
    status: string;
    started_at: string;
    duration_seconds: number;
    grace_seconds: number;
  }[],
  actorId: string,
): Promise<boolean> {
  const now = Date.now();
  const expired = attempts.filter(
    (attempt) =>
      attempt.status === "in_progress" && attemptDeadline(attempt).getTime() < now,
  );
  const results = await Promise.all(
    expired.map((attempt) => finalizeIfExpired(attempt.id, { actorId })),
  );
  return results.some((result) => result?.finalized);
}

/** Milliseconds until started_at + duration (the student-facing time limit, excluding grace). */
export function msUntilTimeLimit(attempt: {
  started_at: string;
  duration_seconds: number;
}): number {
  return Math.max(
    0,
    new Date(attempt.started_at).getTime() + attempt.duration_seconds * 1000 - Date.now(),
  );
}

/** Orders a question's options by the attempt's persisted option_order, if any. */
export function orderOptions<T extends { id: string }>(
  options: T[],
  optionOrder: unknown,
  questionId: string,
): T[] {
  const order =
    optionOrder && typeof optionOrder === "object"
      ? (optionOrder as Record<string, unknown>)[questionId]
      : undefined;
  if (!Array.isArray(order)) return options;
  const rank = new Map(order.map((id, index) => [id, index] as const));
  // Options added after the attempt started sort last, in stored order.
  return [...options].sort(
    (a, b) =>
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function parseQuestionOrder(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : [];
}

function sameSet(a: string[], b: string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const value of setA) {
    if (!setB.has(value)) return false;
  }
  return true;
}

/**
 * Exact-match, all-or-nothing scoring: a question earns its full points
 * only when the selected option set equals the answer-key set; otherwise 0.
 * Questions archived after the attempt started are treated as removed
 * (excluded from both score and max_score). Read-only — the write happens
 * in finalizeIfExpired(). Returns null if the grading data can't be read.
 */
export async function gradeAttempt(
  attempt: Pick<AttemptRow, "id" | "quiz_id" | "question_order">,
): Promise<{ score: number; maxScore: number } | null> {
  const admin = createAdminClient();
  const questionIds = parseQuestionOrder(attempt.question_order);
  if (questionIds.length === 0) return { score: 0, maxScore: 0 };

  const [questionsResult, keysResult, answersResult] = await Promise.all([
    admin
      .from("quiz_questions")
      .select("id, points")
      .eq("quiz_id", attempt.quiz_id)
      .is("archived_at", null)
      .in("id", questionIds),
    admin
      .from("quiz_answer_keys")
      .select("question_id, correct_option_ids")
      .in("question_id", questionIds),
    admin
      .from("quiz_attempt_answers")
      .select("question_id, selected_option_ids")
      .eq("attempt_id", attempt.id),
  ]);

  if (questionsResult.error || keysResult.error || answersResult.error) {
    console.error(
      "gradeAttempt failed to load grading data:",
      questionsResult.error?.message ??
        keysResult.error?.message ??
        answersResult.error?.message,
    );
    return null;
  }

  const keys = new Map<string, string[]>();
  for (const row of keysResult.data ?? []) {
    keys.set(row.question_id as string, (row.correct_option_ids as string[]) ?? []);
  }
  const answers = new Map<string, string[]>();
  for (const row of answersResult.data ?? []) {
    answers.set(row.question_id as string, (row.selected_option_ids as string[]) ?? []);
  }

  let score = 0;
  let maxScore = 0;
  for (const question of questionsResult.data ?? []) {
    const points = Number(question.points);
    maxScore += points;
    const correct = keys.get(question.id as string);
    const selected = answers.get(question.id as string);
    if (correct && correct.length > 0 && selected && sameSet(selected, correct)) {
      score += points;
    }
  }

  return { score, maxScore };
}

/**
 * Idempotent. The ONLY place quiz_attempts.status/score/max_score/
 * submitted_at are written after creation.
 *
 * - Not in_progress → no-op (already finalized).
 * - Past the deadline → grade, mark `timed_out` (whether or not this was an
 *   explicit submit — a late submit is a timeout).
 * - Within the deadline and `submit: true` → grade, mark `submitted`.
 * - Within the deadline otherwise → no-op (nothing to finalize yet).
 *
 * The update is conditional on `status = 'in_progress'`, so two concurrent
 * callers can't both finalize (and double-log) the same attempt.
 */
export async function finalizeIfExpired(
  attemptId: string,
  options: { submit?: boolean; actorId?: string } = {},
): Promise<FinalizeResult | null> {
  const admin = createAdminClient();
  const { data: attempt, error } = await admin
    .from("quiz_attempts")
    .select(
      "id, institute_id, quiz_id, student_id, status, started_at, duration_seconds, grace_seconds, question_order",
    )
    .eq("id", attemptId)
    .maybeSingle<AttemptRow>();

  if (error || !attempt) return null;
  if (attempt.status !== "in_progress") {
    return { status: attempt.status, finalized: false };
  }

  const expired = Date.now() > attemptDeadline(attempt).getTime();
  if (!expired && !options.submit) {
    return { status: "in_progress", finalized: false };
  }

  const nextStatus: AttemptStatus = expired ? "timed_out" : "submitted";
  const graded = await gradeAttempt(attempt);
  if (!graded) return { status: "in_progress", finalized: false };
  const { score, maxScore } = graded;

  const { data: updated, error: updateError } = await admin
    .from("quiz_attempts")
    .update({
      status: nextStatus,
      score,
      max_score: maxScore,
      submitted_at: new Date().toISOString(),
    })
    .eq("id", attempt.id)
    .eq("status", "in_progress")
    .select("status")
    .maybeSingle<{ status: AttemptStatus }>();

  if (updateError) {
    console.error("finalizeIfExpired update failed:", updateError.message);
    return { status: "in_progress", finalized: false };
  }

  if (!updated) {
    // Lost a race with another finalizer — report whatever won.
    const { data: current } = await admin
      .from("quiz_attempts")
      .select("status")
      .eq("id", attempt.id)
      .maybeSingle<{ status: AttemptStatus }>();
    return { status: current?.status ?? nextStatus, finalized: false };
  }

  await logAudit({
    instituteId: attempt.institute_id,
    actorId: attempt.student_id,
    action:
      nextStatus === "timed_out" ? "quiz.attempt.timeout" : "quiz.attempt.submitted",
    target: attempt.id,
    metadata: {
      quizId: attempt.quiz_id,
      score,
      maxScore,
      explicitSubmit: Boolean(options.submit),
      triggeredBy: options.actorId ?? null,
    },
    ip: await getClientIp(),
  });

  return { status: nextStatus, finalized: true };
}

/**
 * The one sanctioned elevated read of answer keys for a student-facing
 * screen: the result page, only after the attempt is finalized AND the quiz
 * has show_answers_after_submit enabled. The caller (a trusted server
 * component) must check both conditions first. Never relaxes
 * quiz_answer_keys' RLS.
 */
export async function getAnswerKeysForReview(
  quizId: string,
  questionIds: string[],
): Promise<Map<string, { correctOptionIds: string[]; explanation: string | null }>> {
  const result = new Map<
    string,
    { correctOptionIds: string[]; explanation: string | null }
  >();
  if (questionIds.length === 0) return result;

  // question_order is attempt data, so re-scope it to questions that really
  // belong to this quiz before reading any keys — an attempt row must never
  // be usable to pull answer keys for a different quiz.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("quiz_answer_keys")
    .select("question_id, correct_option_ids, explanation, quiz_questions!inner(quiz_id)")
    .eq("quiz_questions.quiz_id", quizId)
    .in("question_id", questionIds);

  if (error) {
    console.error("getAnswerKeysForReview failed:", error.message);
    return result;
  }

  for (const row of data ?? []) {
    result.set(row.question_id as string, {
      correctOptionIds: (row.correct_option_ids as string[]) ?? [],
      explanation: (row.explanation as string | null) ?? null,
    });
  }
  return result;
}
