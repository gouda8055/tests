"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { requireTenantRole } from "@/lib/auth/guard";
import { logAudit } from "@/lib/audit/log";
import { formField } from "@/lib/form-data";
import { finalizeIfExpired, parseQuestionOrder } from "@/lib/quizzes/grading";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { createServerClient } from "@/lib/supabase/server";
import {
  saveAnswerSchema,
  startAttemptSchema,
  submitAttemptSchema,
} from "@/lib/validation/quizzes";

export type AttemptActionState = { error: string } | { success: string } | undefined;

const ATTEMPT_ENDED = "This attempt has ended.";

/** In-place Fisher–Yates shuffle using Math.random (unbiased). */
function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j] as T, items[i] as T];
  }
  return items;
}

function attemptPath(courseId: string, quizId: string, attemptId: string) {
  return `/student/courses/${courseId}/quizzes/${quizId}/attempts/${attemptId}`;
}

/**
 * Starts a new attempt (or resumes a live one). Randomization is computed
 * once here and persisted on the row (question_order/option_order), so
 * every later read is a plain column fetch and can never reshuffle an
 * attempt in flight. duration/grace are snapshotted from the quiz now.
 */
export async function startAttempt(
  _prevState: AttemptActionState,
  formData: FormData,
): Promise<AttemptActionState> {
  const actor = await requireTenantRole(["student"]);

  const parsed = startAttemptSchema.safeParse({ quizId: formField(formData, "quizId") });
  if (!parsed.success) return { error: "Invalid request." };
  if (!actor.instituteId) return { error: "Could not start this quiz." };

  const supabase = await createServerClient();

  // RLS (0013) returns the quiz only if it's published, not archived, and
  // the student is enrolled in its course.
  const { data: quiz } = await supabase
    .from("quizzes")
    .select(
      "id, course_id, duration_seconds, grace_seconds, max_attempts, randomize_questions, randomize_options",
    )
    .eq("id", parsed.data.quizId)
    .maybeSingle();
  if (!quiz) return { error: "This quiz isn't available." };

  // Courses RLS hides unpublished/archived courses from students.
  const { data: course } = await supabase
    .from("courses")
    .select("id")
    .eq("id", quiz.course_id)
    .maybeSingle();
  if (!course) return { error: "This quiz isn't available." };

  const { data: existing } = await supabase
    .from("quiz_attempts")
    .select("id, status")
    .eq("quiz_id", quiz.id)
    .eq("student_id", actor.id);

  // Resume a still-live attempt rather than burning another one.
  for (const attempt of existing ?? []) {
    if (attempt.status !== "in_progress") continue;
    const result = await finalizeIfExpired(attempt.id as string, { actorId: actor.id });
    if (result?.status === "in_progress") {
      refresh();
      redirect(attemptPath(quiz.course_id, quiz.id, attempt.id as string));
    }
  }

  // Authoritative attempt-limit check: every attempt ever started counts,
  // regardless of status (an abandoned attempt still used its slot).
  const used = existing?.length ?? 0;
  if (used >= quiz.max_attempts) {
    return {
      error: `You've used all ${quiz.max_attempts} attempt${quiz.max_attempts === 1 ? "" : "s"} for this quiz.`,
    };
  }

  const { data: questions } = await supabase
    .from("quiz_questions")
    .select("id")
    .eq("quiz_id", quiz.id)
    .is("archived_at", null)
    .order("position", { ascending: true });
  const questionIds = (questions ?? []).map((question) => question.id as string);
  if (questionIds.length === 0) return { error: "This quiz has no questions yet." };

  const optionOrder: Record<string, string[]> = {};
  if (quiz.randomize_options) {
    const { data: options } = await supabase
      .from("quiz_question_options")
      .select("id, question_id")
      .in("question_id", questionIds)
      .order("position", { ascending: true });
    const byQuestion = new Map<string, string[]>();
    for (const option of options ?? []) {
      const list = byQuestion.get(option.question_id as string) ?? [];
      list.push(option.id as string);
      byQuestion.set(option.question_id as string, list);
    }
    for (const [questionId, optionIds] of byQuestion) {
      optionOrder[questionId] = shuffle(optionIds);
    }
  }

  const questionOrder = quiz.randomize_questions
    ? shuffle([...questionIds])
    : questionIds;

  const { data: attempt, error } = await supabase
    .from("quiz_attempts")
    .insert({
      institute_id: actor.instituteId,
      quiz_id: quiz.id,
      student_id: actor.id,
      duration_seconds: quiz.duration_seconds,
      grace_seconds: quiz.grace_seconds,
      question_order: questionOrder,
      option_order: optionOrder,
      // Stored for audit/debugging only; the persisted orders above are
      // authoritative and are never re-derived from this.
      seed: Math.floor(Math.random() * 1e9),
    })
    .select("id")
    .single();

  if (error || !attempt) {
    // An RLS denial here (e.g. a race past max_attempts) gets the same
    // generic message — never surface raw database errors.
    return { error: "Could not start this quiz attempt." };
  }

  await logAudit({
    instituteId: actor.instituteId,
    actorId: actor.id,
    action: "quiz.attempt.started",
    target: attempt.id,
    metadata: { quizId: quiz.id, attemptNumber: used + 1 },
    ip: await getClientIp(),
  });

  refresh();
  redirect(attemptPath(quiz.course_id, quiz.id, attempt.id));
}

/**
 * Autosave for one question — an idempotent upsert on
 * (attempt_id, question_id). The deadline is enforced by
 * quiz_attempt_answers' RLS (0017) regardless of this code; the
 * finalizeIfExpired() call up front just turns a stale attempt into a
 * graded one and gives the student a clear message.
 */
export async function saveAnswer(
  attemptId: string,
  questionId: string,
  selectedOptionIds: string[],
): Promise<AttemptActionState> {
  const actor = await requireTenantRole(["student"]);

  const parsed = saveAnswerSchema.safeParse({ attemptId, questionId, selectedOptionIds });
  if (!parsed.success) return { error: "Invalid answer." };
  if (!actor.instituteId) return { error: "Could not save your answer." };

  const allowed = await checkRateLimit("quiz.save", 120, 60, actor.id);
  if (!allowed) return { error: "You're saving too quickly. Please wait a moment." };

  const supabase = await createServerClient();
  const { data: attempt } = await supabase
    .from("quiz_attempts")
    .select("id, quiz_id, question_order")
    .eq("id", parsed.data.attemptId)
    .eq("student_id", actor.id)
    .maybeSingle();
  if (!attempt) return { error: "Attempt not found." };

  const state = await finalizeIfExpired(attempt.id as string, { actorId: actor.id });
  if (!state || state.status !== "in_progress") return { error: ATTEMPT_ENDED };

  if (!parseQuestionOrder(attempt.question_order).includes(parsed.data.questionId)) {
    return { error: "That question isn't part of this attempt." };
  }

  const [{ data: question }, { data: options }] = await Promise.all([
    supabase
      .from("quiz_questions")
      .select("id, question_type")
      .eq("id", parsed.data.questionId)
      .eq("quiz_id", attempt.quiz_id)
      .maybeSingle(),
    supabase
      .from("quiz_question_options")
      .select("id")
      .eq("question_id", parsed.data.questionId),
  ]);
  if (!question) return { error: "That question isn't part of this attempt." };

  const validOptionIds = new Set((options ?? []).map((option) => option.id as string));
  if (parsed.data.selectedOptionIds.some((id) => !validOptionIds.has(id))) {
    return { error: "Invalid answer." };
  }
  if (
    question.question_type === "single_choice" &&
    parsed.data.selectedOptionIds.length > 1
  ) {
    return { error: "Choose only one option." };
  }

  const { data: previous } = await supabase
    .from("quiz_attempt_answers")
    .select("id")
    .eq("attempt_id", attempt.id)
    .eq("question_id", parsed.data.questionId)
    .maybeSingle();

  const { error } = await supabase.from("quiz_attempt_answers").upsert(
    {
      institute_id: actor.instituteId,
      attempt_id: attempt.id,
      question_id: parsed.data.questionId,
      selected_option_ids: parsed.data.selectedOptionIds,
      answered_at: new Date().toISOString(),
    },
    { onConflict: "attempt_id,question_id" },
  );

  if (error) {
    // 42501 = RLS rejected the write: the attempt's deadline has passed.
    return {
      error:
        error.code === "42501"
          ? "Time is up — this answer was not saved."
          : "Could not save your answer.",
    };
  }

  // Only the first save per question is audited, so a live exam's
  // autosaves don't flood audit_logs.
  if (!previous) {
    await logAudit({
      instituteId: actor.instituteId,
      actorId: actor.id,
      action: "quiz.attempt.saved",
      target: attempt.id as string,
      metadata: { questionId: parsed.data.questionId },
      ip: await getClientIp(),
    });
  }

  return { success: "Saved." };
}

/**
 * Explicit submit. Ownership is verified through RLS first; grading and the
 * status flip happen only inside finalizeIfExpired() (service role), which
 * marks the attempt `submitted` if on time or `timed_out` if late, and is a
 * no-op for an attempt that's already finalized (no re-submission).
 */
export async function submitAttempt(
  _prevState: AttemptActionState,
  formData: FormData,
): Promise<AttemptActionState> {
  const actor = await requireTenantRole(["student"]);

  const parsed = submitAttemptSchema.safeParse({
    attemptId: formField(formData, "attemptId"),
  });
  if (!parsed.success) return { error: "Invalid request." };

  const supabase = await createServerClient();
  const { data: attempt } = await supabase
    .from("quiz_attempts")
    .select("id, quiz_id, quizzes(course_id)")
    .eq("id", parsed.data.attemptId)
    .eq("student_id", actor.id)
    .maybeSingle();
  if (!attempt) return { error: "Attempt not found." };

  const result = await finalizeIfExpired(attempt.id as string, {
    submit: true,
    actorId: actor.id,
  });
  if (!result || result.status === "in_progress") {
    return { error: "Could not submit your attempt. Please try again." };
  }

  const quiz = attempt.quizzes as unknown as { course_id: string } | null;
  if (!quiz) return { success: "Attempt submitted." };

  refresh();
  redirect(
    `${attemptPath(quiz.course_id, attempt.quiz_id as string, attempt.id as string)}/result`,
  );
}
