"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { requireTenantRole, type SessionProfile } from "@/lib/auth/guard";
import { logAudit } from "@/lib/audit/log";
import { canManage } from "@/lib/courses/ownership";
import { formCheckbox, formField, formFields } from "@/lib/form-data";
import { getClientIp } from "@/lib/request-ip";
import { createServerClient } from "@/lib/supabase/server";
import {
  createQuestionSchema,
  createQuizSchema,
  questionIdSchema,
  quizIdSchema,
  setQuizStatusSchema,
  updateQuestionSchema,
  updateQuizSchema,
} from "@/lib/validation/quizzes";

export type QuizActionState = { error: string } | { success: string } | undefined;

const NOT_ALLOWED = "You can only manage quizzes you created.";

/**
 * Quiz/question authoring. Every write uses the session client — the RLS
 * policies in 0013-0015 already scope writes to the caller's institute and
 * apply the creator-only rule (owner overrides). quiz_answer_keys is
 * written here through the session client too: its staff-only insert/
 * update policies allow exactly this, and only grading.ts ever reads it
 * with elevated privileges.
 */

type Supabase = Awaited<ReturnType<typeof createServerClient>>;

async function loadManageableQuiz(
  supabase: Supabase,
  actor: SessionProfile,
  quizId: string,
) {
  const { data: quiz } = await supabase
    .from("quizzes")
    .select("id, course_id, created_by")
    .eq("id", quizId)
    .maybeSingle();
  if (!quiz) return { ok: false, error: "Quiz not found." } as const;
  if (!canManage(actor, quiz.created_by))
    return { ok: false, error: NOT_ALLOWED } as const;
  return {
    ok: true,
    quiz: { id: quiz.id as string, courseId: quiz.course_id as string },
  } as const;
}

async function loadManageableQuestion(
  supabase: Supabase,
  actor: SessionProfile,
  questionId: string,
) {
  const { data: question } = await supabase
    .from("quiz_questions")
    .select("id, quiz_id, quizzes(course_id, created_by)")
    .eq("id", questionId)
    .maybeSingle();
  if (!question) return { ok: false, error: "Question not found." } as const;
  const parent = question.quizzes as unknown as {
    course_id: string;
    created_by: string | null;
  } | null;
  if (!parent || !canManage(actor, parent.created_by)) {
    return { ok: false, error: NOT_ALLOWED } as const;
  }
  return {
    ok: true,
    question: {
      id: question.id as string,
      quizId: question.quiz_id as string,
      courseId: parent.course_id,
    },
  } as const;
}

function quizInput(formData: FormData) {
  return {
    title: formField(formData, "title"),
    description: formField(formData, "description"),
    lessonId: formField(formData, "lessonId"),
    durationMinutes: formField(formData, "durationMinutes"),
    graceSeconds: formField(formData, "graceSeconds"),
    maxAttempts: formField(formData, "maxAttempts"),
    randomizeQuestions: formCheckbox(formData, "randomizeQuestions"),
    randomizeOptions: formCheckbox(formData, "randomizeOptions"),
    showAnswersAfterSubmit: formCheckbox(formData, "showAnswersAfterSubmit"),
  };
}

async function lessonBelongsToCourse(
  supabase: Supabase,
  lessonId: string,
  courseId: string,
) {
  const { data } = await supabase
    .from("lessons")
    .select("id")
    .eq("id", lessonId)
    .eq("course_id", courseId)
    .maybeSingle();
  return Boolean(data);
}

export async function createQuiz(
  _prevState: QuizActionState,
  formData: FormData,
): Promise<QuizActionState> {
  const actor = await requireTenantRole(["institute_owner", "instructor"]);

  const parsed = createQuizSchema.safeParse({
    courseId: formField(formData, "courseId"),
    ...quizInput(formData),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  if (!actor.instituteId) return { error: "Could not create quiz." };

  const supabase = await createServerClient();
  const { data: course } = await supabase
    .from("courses")
    .select("id, created_by")
    .eq("id", parsed.data.courseId)
    .maybeSingle();
  if (!course) return { error: "Course not found." };
  if (!canManage(actor, course.created_by)) {
    return { error: "You can only add quizzes to courses you created." };
  }
  if (
    parsed.data.lessonId &&
    !(await lessonBelongsToCourse(supabase, parsed.data.lessonId, course.id))
  ) {
    return { error: "That lesson isn't part of this course." };
  }

  const { data, error } = await supabase
    .from("quizzes")
    .insert({
      institute_id: actor.instituteId,
      course_id: course.id,
      lesson_id: parsed.data.lessonId ?? null,
      created_by: actor.id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      duration_seconds: parsed.data.durationMinutes * 60,
      grace_seconds: parsed.data.graceSeconds,
      max_attempts: parsed.data.maxAttempts,
      randomize_questions: parsed.data.randomizeQuestions,
      randomize_options: parsed.data.randomizeOptions,
      show_answers_after_submit: parsed.data.showAnswersAfterSubmit,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "Could not create quiz." };

  await logAudit({
    instituteId: actor.instituteId,
    actorId: actor.id,
    action: "quiz.created",
    target: data.id,
    metadata: { courseId: course.id, title: parsed.data.title },
    ip: await getClientIp(),
  });

  // See courses/actions.ts createCourse for why refresh() must precede a
  // redirect into a page the client router hasn't cached yet.
  refresh();
  redirect(`/admin/courses/${course.id}/quizzes/${data.id}`);
}

export async function updateQuiz(
  _prevState: QuizActionState,
  formData: FormData,
): Promise<QuizActionState> {
  const actor = await requireTenantRole(["institute_owner", "instructor"]);

  const parsed = updateQuizSchema.safeParse({
    quizId: formField(formData, "quizId"),
    ...quizInput(formData),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createServerClient();
  const loaded = await loadManageableQuiz(supabase, actor, parsed.data.quizId);
  if (!loaded.ok) return { error: loaded.error };
  if (
    parsed.data.lessonId &&
    !(await lessonBelongsToCourse(supabase, parsed.data.lessonId, loaded.quiz.courseId))
  ) {
    return { error: "That lesson isn't part of this course." };
  }

  // duration/grace edits never affect attempts already in flight: those
  // are snapshotted onto quiz_attempts at start (0016).
  const { data, error } = await supabase
    .from("quizzes")
    .update({
      lesson_id: parsed.data.lessonId ?? null,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      duration_seconds: parsed.data.durationMinutes * 60,
      grace_seconds: parsed.data.graceSeconds,
      max_attempts: parsed.data.maxAttempts,
      randomize_questions: parsed.data.randomizeQuestions,
      randomize_options: parsed.data.randomizeOptions,
      show_answers_after_submit: parsed.data.showAnswersAfterSubmit,
    })
    .eq("id", parsed.data.quizId)
    .select("id")
    .maybeSingle();

  if (error || !data) return { error: "Could not update quiz." };

  await logAudit({
    instituteId: actor.instituteId,
    actorId: actor.id,
    action: "quiz.updated",
    target: data.id,
    metadata: { courseId: loaded.quiz.courseId, title: parsed.data.title },
    ip: await getClientIp(),
  });

  refresh();
  return { success: "Quiz saved." };
}

export async function setQuizStatus(
  _prevState: QuizActionState,
  formData: FormData,
): Promise<QuizActionState> {
  const actor = await requireTenantRole(["institute_owner", "instructor"]);

  const parsed = setQuizStatusSchema.safeParse({
    quizId: formField(formData, "quizId"),
    status: formField(formData, "status"),
  });
  if (!parsed.success) return { error: "Invalid request." };

  const supabase = await createServerClient();
  const loaded = await loadManageableQuiz(supabase, actor, parsed.data.quizId);
  if (!loaded.ok) return { error: loaded.error };

  if (parsed.data.status === "published") {
    const { count } = await supabase
      .from("quiz_questions")
      .select("id", { count: "exact", head: true })
      .eq("quiz_id", parsed.data.quizId)
      .is("archived_at", null);
    if (!count) return { error: "Add at least one question before publishing." };
  }

  const { data, error } = await supabase
    .from("quizzes")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.quizId)
    .select("id")
    .maybeSingle();

  if (error || !data) return { error: "Could not update quiz status." };

  await logAudit({
    instituteId: actor.instituteId,
    actorId: actor.id,
    action: parsed.data.status === "published" ? "quiz.published" : "quiz.unpublished",
    target: data.id,
    metadata: { courseId: loaded.quiz.courseId },
    ip: await getClientIp(),
  });

  refresh();
  return { success: `Quiz is now ${parsed.data.status}.` };
}

export async function archiveQuiz(
  _prevState: QuizActionState,
  formData: FormData,
): Promise<QuizActionState> {
  const actor = await requireTenantRole(["institute_owner", "instructor"]);

  const parsed = quizIdSchema.safeParse({ quizId: formField(formData, "quizId") });
  if (!parsed.success) return { error: "Invalid request." };

  const supabase = await createServerClient();
  const loaded = await loadManageableQuiz(supabase, actor, parsed.data.quizId);
  if (!loaded.ok) return { error: loaded.error };

  const { data, error } = await supabase
    .from("quizzes")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", parsed.data.quizId)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();

  if (error) return { error: "Could not archive quiz." };
  if (!data) return { error: "Quiz is already archived." };

  await logAudit({
    instituteId: actor.instituteId,
    actorId: actor.id,
    action: "quiz.archived",
    target: data.id,
    metadata: { courseId: loaded.quiz.courseId },
    ip: await getClientIp(),
  });

  refresh();
  return { success: "Quiz archived." };
}

/**
 * Inserts the question, its options, and its quiz_answer_keys row. There is
 * no delete policy anywhere (by design), so if a later step fails the
 * half-created question is archived rather than left visible.
 *
 * Form shape: N `optionText` slots (blank ones ignored) and `correct`
 * checkboxes whose values are slot indices.
 */
export async function createQuestion(
  _prevState: QuizActionState,
  formData: FormData,
): Promise<QuizActionState> {
  const actor = await requireTenantRole(["institute_owner", "instructor"]);

  const correctSlots = new Set(formFields(formData, "correct"));
  const options = formFields(formData, "optionText")
    .map((text, slot) => ({ text: text.trim(), correct: correctSlots.has(String(slot)) }))
    .filter((option) => option.text !== "");

  const parsed = createQuestionSchema.safeParse({
    quizId: formField(formData, "quizId"),
    questionText: formField(formData, "questionText"),
    questionType: formField(formData, "questionType"),
    points: formField(formData, "points"),
    explanation: formField(formData, "explanation"),
    options,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  if (!actor.instituteId) return { error: "Could not create question." };

  const supabase = await createServerClient();
  const loaded = await loadManageableQuiz(supabase, actor, parsed.data.quizId);
  if (!loaded.ok) return { error: loaded.error };

  const { data: last } = await supabase
    .from("quiz_questions")
    .select("position")
    .eq("quiz_id", parsed.data.quizId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: question, error: questionError } = await supabase
    .from("quiz_questions")
    .insert({
      institute_id: actor.instituteId,
      quiz_id: parsed.data.quizId,
      position: (last?.position ?? -1) + 1,
      question_text: parsed.data.questionText,
      question_type: parsed.data.questionType,
      points: parsed.data.points,
    })
    .select("id")
    .single();

  if (questionError || !question) return { error: "Could not create question." };

  const { data: insertedOptions, error: optionsError } = await supabase
    .from("quiz_question_options")
    .insert(
      parsed.data.options.map((option, position) => ({
        institute_id: actor.instituteId,
        question_id: question.id,
        position,
        option_text: option.text,
      })),
    )
    .select("id, position");

  const correctOptionIds = (insertedOptions ?? [])
    .filter((row) => parsed.data.options[row.position as number]?.correct)
    .map((row) => row.id as string);

  const keyError =
    optionsError || !insertedOptions || correctOptionIds.length === 0
      ? true
      : (
          await supabase.from("quiz_answer_keys").insert({
            institute_id: actor.instituteId,
            question_id: question.id,
            correct_option_ids: correctOptionIds,
            explanation: parsed.data.explanation ?? null,
          })
        ).error;

  if (keyError) {
    await supabase
      .from("quiz_questions")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", question.id);
    return { error: "Could not create question." };
  }

  await logAudit({
    instituteId: actor.instituteId,
    actorId: actor.id,
    action: "quiz.question.created",
    target: question.id,
    metadata: { quizId: parsed.data.quizId },
    ip: await getClientIp(),
  });

  // See courses/actions.ts createCourse for why refresh() must precede a
  // redirect, even back to an already-visited page.
  refresh();
  redirect(`/admin/courses/${loaded.quiz.courseId}/quizzes/${parsed.data.quizId}`);
}

/**
 * Edits a question in place. Options are never deleted or re-inserted
 * (that would invalidate an in-progress attempt's stored option_order —
 * see 0014's table comment): existing ones are updated by id, and new ones
 * may be appended.
 *
 * Form shape: paired `existingOptionId`/`existingOptionText` fields with
 * `correctExisting` checkboxes valued by option id; `newOptionText` slots
 * with `correctNew` checkboxes valued by slot index.
 */
export async function updateQuestion(
  _prevState: QuizActionState,
  formData: FormData,
): Promise<QuizActionState> {
  const actor = await requireTenantRole(["institute_owner", "instructor"]);

  const existingIds = formFields(formData, "existingOptionId");
  const existingTexts = formFields(formData, "existingOptionText");
  if (existingIds.length !== existingTexts.length) return { error: "Invalid request." };
  const correctExisting = new Set(formFields(formData, "correctExisting"));
  const correctNew = new Set(formFields(formData, "correctNew"));

  const parsed = updateQuestionSchema.safeParse({
    questionId: formField(formData, "questionId"),
    questionText: formField(formData, "questionText"),
    questionType: formField(formData, "questionType"),
    points: formField(formData, "points"),
    explanation: formField(formData, "explanation"),
    existingOptions: existingIds.map((id, index) => ({
      id,
      text: existingTexts[index] ?? "",
      correct: correctExisting.has(id),
    })),
    newOptions: formFields(formData, "newOptionText")
      .map((text, slot) => ({ text: text.trim(), correct: correctNew.has(String(slot)) }))
      .filter((option) => option.text !== ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  if (!actor.instituteId) return { error: "Could not update question." };

  const supabase = await createServerClient();
  const loaded = await loadManageableQuestion(supabase, actor, parsed.data.questionId);
  if (!loaded.ok) return { error: loaded.error };
  const { question } = loaded;

  const { data: storedOptions } = await supabase
    .from("quiz_question_options")
    .select("id, position, option_text")
    .eq("question_id", question.id);
  const stored = new Map(
    (storedOptions ?? []).map((row) => [row.id as string, row] as const),
  );

  // Every stored option must be submitted (none can be dropped) and every
  // submitted id must belong to this question.
  if (
    parsed.data.existingOptions.length !== stored.size ||
    parsed.data.existingOptions.some((option) => !stored.has(option.id))
  ) {
    return { error: "Options changed since this page loaded. Reload and try again." };
  }

  const { error: questionError } = await supabase
    .from("quiz_questions")
    .update({
      question_text: parsed.data.questionText,
      question_type: parsed.data.questionType,
      points: parsed.data.points,
    })
    .eq("id", question.id);
  if (questionError) return { error: "Could not update question." };

  for (const option of parsed.data.existingOptions) {
    if (stored.get(option.id)?.option_text === option.text) continue;
    const { error } = await supabase
      .from("quiz_question_options")
      .update({ option_text: option.text })
      .eq("id", option.id)
      .eq("question_id", question.id);
    if (error) return { error: "Could not update an option." };
  }

  const correctOptionIds = parsed.data.existingOptions
    .filter((option) => option.correct)
    .map((option) => option.id);

  if (parsed.data.newOptions.length > 0) {
    const nextPosition =
      Math.max(-1, ...[...stored.values()].map((row) => row.position as number)) + 1;
    const { data: inserted, error } = await supabase
      .from("quiz_question_options")
      .insert(
        parsed.data.newOptions.map((option, index) => ({
          institute_id: actor.instituteId,
          question_id: question.id,
          position: nextPosition + index,
          option_text: option.text,
        })),
      )
      .select("id, position");
    if (error || !inserted) return { error: "Could not add the new options." };
    for (const row of inserted) {
      if (parsed.data.newOptions[(row.position as number) - nextPosition]?.correct) {
        correctOptionIds.push(row.id as string);
      }
    }
  }

  const keyFields = {
    correct_option_ids: correctOptionIds,
    explanation: parsed.data.explanation ?? null,
  };
  const { data: updatedKey, error: keyError } = await supabase
    .from("quiz_answer_keys")
    .update(keyFields)
    .eq("question_id", question.id)
    .select("id")
    .maybeSingle();
  if (keyError) return { error: "Could not update the answer key." };
  if (!updatedKey) {
    const { error } = await supabase.from("quiz_answer_keys").insert({
      institute_id: actor.instituteId,
      question_id: question.id,
      ...keyFields,
    });
    if (error) return { error: "Could not save the answer key." };
  }

  await logAudit({
    instituteId: actor.instituteId,
    actorId: actor.id,
    action: "quiz.question.updated",
    target: question.id,
    metadata: { quizId: question.quizId },
    ip: await getClientIp(),
  });

  refresh();
  return { success: "Question saved." };
}

export async function archiveQuestion(
  _prevState: QuizActionState,
  formData: FormData,
): Promise<QuizActionState> {
  const actor = await requireTenantRole(["institute_owner", "instructor"]);

  const parsed = questionIdSchema.safeParse({
    questionId: formField(formData, "questionId"),
  });
  if (!parsed.success) return { error: "Invalid request." };

  const supabase = await createServerClient();
  const loaded = await loadManageableQuestion(supabase, actor, parsed.data.questionId);
  if (!loaded.ok) return { error: loaded.error };

  const { data, error } = await supabase
    .from("quiz_questions")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", parsed.data.questionId)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();

  if (error) return { error: "Could not archive question." };
  if (!data) return { error: "Question is already archived." };

  await logAudit({
    instituteId: actor.instituteId,
    actorId: actor.id,
    action: "quiz.question.archived",
    target: data.id,
    metadata: { quizId: loaded.question.quizId },
    ip: await getClientIp(),
  });

  refresh();
  return { success: "Question archived." };
}
