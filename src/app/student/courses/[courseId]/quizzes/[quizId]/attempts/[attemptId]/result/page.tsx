import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireTenantRole } from "@/lib/auth/guard";
import { formatDateTime, formatScore } from "@/lib/format";
import {
  finalizeIfExpired,
  getAnswerKeysForReview,
  orderOptions,
  parseQuestionOrder,
} from "@/lib/quizzes/grading";
import { createServerClient } from "@/lib/supabase/server";
import { AttemptReview, type ReviewQuestion } from "@/components/quizzes/attempt-review";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ATTEMPT_COLUMNS =
  "id, quiz_id, status, started_at, submitted_at, score, max_score, question_order, option_order";

export default async function StudentAttemptResultPage({
  params,
}: {
  params: Promise<{ courseId: string; quizId: string; attemptId: string }>;
}) {
  const profile = await requireTenantRole(["student"]);
  const { courseId, quizId, attemptId } = await params;

  const supabase = await createServerClient();
  const { data: quiz } = await supabase
    .from("quizzes")
    .select("id, course_id, title, show_answers_after_submit")
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
      .eq("student_id", profile.id)
      .maybeSingle();

  let { data: attempt } = await loadAttempt();
  if (!attempt) notFound();

  const attemptPath = `/student/courses/${quiz.course_id}/quizzes/${quiz.id}/attempts/${attempt.id}`;
  if (attempt.status === "in_progress") {
    const state = await finalizeIfExpired(attempt.id as string, { actorId: profile.id });
    if (!state || state.status === "in_progress") redirect(attemptPath);
    ({ data: attempt } = await loadAttempt());
    if (!attempt) notFound();
  }

  let review: ReviewQuestion[] = [];
  // Correct answers are revealed only for a finalized attempt on a quiz
  // that allows it — via the one sanctioned elevated read in grading.ts.
  if (quiz.show_answers_after_submit && attempt.status !== "in_progress") {
    const questionIds = parseQuestionOrder(attempt.question_order);
    const [{ data: questions }, { data: options }, { data: answers }, keys] =
      await Promise.all([
        supabase
          .from("quiz_questions")
          .select("id, question_text, points")
          .in("id", questionIds)
          .is("archived_at", null),
        supabase
          .from("quiz_question_options")
          .select("id, question_id, option_text")
          .in("question_id", questionIds)
          .order("position", { ascending: true }),
        supabase
          .from("quiz_attempt_answers")
          .select("question_id, selected_option_ids")
          .eq("attempt_id", attempt.id),
        getAnswerKeysForReview(quiz.id, questionIds),
      ]);

    const questionById = new Map((questions ?? []).map((q) => [q.id as string, q]));
    const answerByQuestion = new Map(
      (answers ?? []).map((a) => [
        a.question_id as string,
        a.selected_option_ids as string[],
      ]),
    );
    review = questionIds.flatMap((id) => {
      const question = questionById.get(id);
      if (!question) return [];
      const key = keys.get(id);
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
          correct: key?.correctOptionIds ?? [],
          explanation: key?.explanation ?? null,
        },
      ];
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <div>
        <Link
          href={`/student/courses/${quiz.course_id}/quizzes/${quiz.id}`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← {quiz.title}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Result</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <span className="text-2xl">
              {formatScore(attempt.score, attempt.max_score)}
            </span>
            <StatusBadge status={attempt.status} />
          </CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground flex flex-col gap-1 text-sm">
          <p>Started: {formatDateTime(attempt.started_at)}</p>
          <p>Submitted: {formatDateTime(attempt.submitted_at)}</p>
          {attempt.status === "timed_out" ? (
            <p>Time ran out — your saved answers were graded.</p>
          ) : null}
          {!quiz.show_answers_after_submit ? (
            <p>Correct answers aren&apos;t shown for this quiz.</p>
          ) : null}
        </CardContent>
      </Card>
      {review.length > 0 ? <AttemptReview questions={review} /> : null}
    </main>
  );
}
