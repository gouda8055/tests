import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTenantRole } from "@/lib/auth/guard";
import { getStudentNames } from "@/lib/courses/student-names";
import { formatDateTime, formatScore } from "@/lib/format";
import {
  finalizeIfExpired,
  orderOptions,
  parseQuestionOrder,
} from "@/lib/quizzes/grading";
import { createServerClient } from "@/lib/supabase/server";
import { AttemptReview, type ReviewQuestion } from "@/components/quizzes/attempt-review";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ATTEMPT_COLUMNS =
  "id, quiz_id, student_id, status, started_at, submitted_at, score, max_score, question_order, option_order";

export default async function AdminAttemptPage({
  params,
}: {
  params: Promise<{ courseId: string; quizId: string; attemptId: string }>;
}) {
  const profile = await requireTenantRole(["institute_owner", "instructor"]);
  const { courseId, quizId, attemptId } = await params;

  const supabase = await createServerClient();
  const { data: quiz } = await supabase
    .from("quizzes")
    .select("id, course_id, title")
    .eq("id", quizId)
    .eq("course_id", courseId)
    .maybeSingle();
  if (!quiz) notFound();

  const loadAttempt = () =>
    supabase
      .from("quiz_attempts")
      .select(ATTEMPT_COLUMNS)
      .eq("id", attemptId)
      .eq("quiz_id", quiz.id)
      .maybeSingle();

  let { data: attempt } = await loadAttempt();
  if (!attempt) notFound();

  if (attempt.status === "in_progress") {
    const result = await finalizeIfExpired(attempt.id as string, { actorId: profile.id });
    if (result?.finalized) ({ data: attempt } = await loadAttempt());
    if (!attempt) notFound();
  }

  const questionIds = parseQuestionOrder(attempt.question_order);
  const [{ data: questions }, { data: options }, { data: answers }, { data: keys }] =
    await Promise.all([
      supabase
        .from("quiz_questions")
        .select("id, question_text, points, archived_at")
        .in("id", questionIds),
      supabase
        .from("quiz_question_options")
        .select("id, question_id, option_text, position")
        .in("question_id", questionIds)
        .order("position", { ascending: true }),
      supabase
        .from("quiz_attempt_answers")
        .select("question_id, selected_option_ids")
        .eq("attempt_id", attempt.id),
      // Session client: returns rows only for the quiz creator / owner (0015).
      supabase
        .from("quiz_answer_keys")
        .select("question_id, correct_option_ids, explanation")
        .in("question_id", questionIds),
    ]);

  const questionById = new Map((questions ?? []).map((q) => [q.id as string, q]));
  const keyByQuestion = new Map((keys ?? []).map((k) => [k.question_id as string, k]));
  const answerByQuestion = new Map(
    (answers ?? []).map((a) => [
      a.question_id as string,
      a.selected_option_ids as string[],
    ]),
  );

  const review: ReviewQuestion[] = questionIds.flatMap((id) => {
    const question = questionById.get(id);
    if (!question || question.archived_at) return [];
    const key = keyByQuestion.get(id);
    return [
      {
        id,
        text: question.question_text as string,
        points: Number(question.points),
        options: orderOptions(
          (options ?? [])
            .filter((option) => option.question_id === id)
            .map((option) => ({
              id: option.id as string,
              text: option.option_text as string,
            })),
          attempt.option_order,
          id,
        ),
        selected: answerByQuestion.get(id) ?? [],
        correct: key ? ((key.correct_option_ids as string[]) ?? []) : null,
        explanation: key ? ((key.explanation as string | null) ?? null) : null,
      },
    ];
  });

  const names = profile.instituteId
    ? await getStudentNames(profile.instituteId, [attempt.student_id as string])
    : new Map<string, string>();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-8">
      <div>
        <Link
          href={`/admin/courses/${quiz.course_id}/quizzes/${quiz.id}/attempts`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Attempts
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">
            {names.get(attempt.student_id as string) ?? "Unknown student"}
          </h1>
          <StatusBadge status={attempt.status} />
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{quiz.title}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
          <p>
            <span className="text-muted-foreground">Score:</span>{" "}
            {formatScore(attempt.score, attempt.max_score)}
          </p>
          <p>
            <span className="text-muted-foreground">Started:</span>{" "}
            {formatDateTime(attempt.started_at)}
          </p>
          <p>
            <span className="text-muted-foreground">Submitted:</span>{" "}
            {formatDateTime(attempt.submitted_at)}
          </p>
        </CardContent>
      </Card>
      {keys && keys.length === 0 && review.length > 0 ? (
        <p className="text-muted-foreground text-sm">
          Correct answers are visible only to this quiz&apos;s creator and the institute
          owner.
        </p>
      ) : null}
      <AttemptReview questions={review} />
    </main>
  );
}
