import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTenantRole } from "@/lib/auth/guard";
import { isQuestionCorrect } from "@/lib/quizzes/correctness";
import { finalizeExpiredAttempts, parseQuestionOrder } from "@/lib/quizzes/grading";
import { createServerClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const BUCKET_COUNT = 10; // 0-10%, 10-20%, ..., 90-100%

type PerQuestionStat = {
  id: string;
  text: string;
  points: number;
  attempted: number;
  correct: number;
};

export default async function QuizAnalyticsPage({
  params,
}: {
  params: Promise<{ courseId: string; quizId: string }>;
}) {
  const profile = await requireTenantRole(["institute_owner", "instructor"]);
  const { courseId, quizId } = await params;

  const supabase = await createServerClient();
  const { data: quiz } = await supabase
    .from("quizzes")
    .select("id, course_id, title")
    .eq("id", quizId)
    .eq("course_id", courseId)
    .maybeSingle();
  if (!quiz) notFound();

  const loadAttempts = () =>
    supabase
      .from("quiz_attempts")
      .select("id, status, started_at, duration_seconds, grace_seconds, score, max_score, question_order")
      .eq("quiz_id", quiz.id);

  let { data: attempts } = await loadAttempts();
  // Same lazy sweep the attempts/export pages already do, so a stale
  // in_progress attempt never skews these numbers.
  if (await finalizeExpiredAttempts(attempts ?? [], profile.id)) {
    ({ data: attempts } = await loadAttempts());
  }
  const attemptList = attempts ?? [];

  const base = `/admin/courses/${quiz.course_id}/quizzes/${quiz.id}`;

  const byStatus = { in_progress: 0, submitted: 0, timed_out: 0 } as Record<string, number>;
  const percentages: number[] = [];
  // Pool_size means different attempts can sample different question
  // subsets, so max_score isn't constant per quiz — average the per-
  // attempt percentage, not the raw score, and attribute each question's
  // correct-rate only over attempts that actually included it.
  const questionAttemptIds = new Map<string, string[]>();

  for (const attempt of attemptList) {
    byStatus[attempt.status as string] = (byStatus[attempt.status as string] ?? 0) + 1;
    const maxScore = Number(attempt.max_score);
    if (attempt.status !== "in_progress" && maxScore > 0) {
      percentages.push((Number(attempt.score) / maxScore) * 100);
    }
    for (const questionId of parseQuestionOrder(attempt.question_order)) {
      const list = questionAttemptIds.get(questionId) ?? [];
      list.push(attempt.id as string);
      questionAttemptIds.set(questionId, list);
    }
  }

  const averagePercent =
    percentages.length > 0
      ? percentages.reduce((sum, value) => sum + value, 0) / percentages.length
      : null;

  const buckets = Array.from({ length: BUCKET_COUNT }, () => 0);
  for (const pct of percentages) {
    const index = Math.min(BUCKET_COUNT - 1, Math.floor(pct / (100 / BUCKET_COUNT)));
    buckets[index] = (buckets[index] ?? 0) + 1;
  }
  const maxBucketCount = Math.max(1, ...buckets);

  const allQuestionIds = [...questionAttemptIds.keys()];
  const [{ data: questions }, { data: keys }, { data: answers }] = await Promise.all([
    allQuestionIds.length > 0
      ? supabase
          .from("quiz_questions")
          .select("id, question_text, question_type, points")
          .in("id", allQuestionIds)
      : Promise.resolve({ data: [] }),
    allQuestionIds.length > 0
      ? supabase
          .from("quiz_answer_keys")
          .select("question_id, correct_option_ids, correct_text_answers")
          .in("question_id", allQuestionIds)
      : Promise.resolve({ data: [] }),
    attemptList.length > 0
      ? supabase
          .from("quiz_attempt_answers")
          .select("attempt_id, question_id, selected_option_ids, text_answer")
          .in(
            "attempt_id",
            attemptList.map((a) => a.id as string),
          )
      : Promise.resolve({ data: [] }),
  ]);

  const keyByQuestion = new Map(
    (keys ?? []).map((k) => [
      k.question_id as string,
      {
        correctOptionIds: (k.correct_option_ids as string[] | null) ?? null,
        correctTextAnswers: (k.correct_text_answers as string[] | null) ?? null,
      },
    ]),
  );
  const answerByAttemptQuestion = new Map(
    (answers ?? []).map((a) => [
      `${a.attempt_id}:${a.question_id}`,
      {
        selectedOptionIds: (a.selected_option_ids as string[]) ?? [],
        textAnswer: (a.text_answer as string | null) ?? null,
      },
    ]),
  );

  const perQuestion: PerQuestionStat[] = (questions ?? []).map((question) => {
    const id = question.id as string;
    const attemptIds = questionAttemptIds.get(id) ?? [];
    const key = keyByQuestion.get(id);
    const correct = key
      ? attemptIds.filter((attemptId) =>
          isQuestionCorrect(
            question.question_type as string,
            key,
            answerByAttemptQuestion.get(`${attemptId}:${id}`),
          ),
        ).length
      : 0;
    return {
      id,
      text: question.question_text as string,
      points: Number(question.points),
      attempted: attemptIds.length,
      correct,
    };
  });

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-8">
      <div>
        <Link href={base} className="text-muted-foreground text-sm hover:underline">
          ← {quiz.title}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Analytics</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-4">
          <p>
            <span className="text-muted-foreground">In progress:</span>{" "}
            {byStatus.in_progress ?? 0}
          </p>
          <p>
            <span className="text-muted-foreground">Submitted:</span>{" "}
            {byStatus.submitted ?? 0}
          </p>
          <p>
            <span className="text-muted-foreground">Timed out:</span>{" "}
            {byStatus.timed_out ?? 0}
          </p>
          <p>
            <span className="text-muted-foreground">Average score:</span>{" "}
            {averagePercent === null ? "—" : `${averagePercent.toFixed(1)}%`}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Score distribution</CardTitle>
        </CardHeader>
        <CardContent>
          {percentages.length === 0 ? (
            <p className="text-muted-foreground text-sm">No graded attempts yet.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {buckets.map((count, index) => (
                <div key={index} className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground w-14 shrink-0">
                    {index * 10}-{index * 10 + 10}%
                  </span>
                  <div className="bg-muted h-4 flex-1 overflow-hidden rounded-sm">
                    <div
                      className="bg-primary h-full"
                      style={{ width: `${(count / maxBucketCount) * 100}%` }}
                    />
                  </div>
                  <span className="w-6 shrink-0 text-right">{count}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per-question correct rate</CardTitle>
        </CardHeader>
        <CardContent>
          {perQuestion.length === 0 ? (
            <p className="text-muted-foreground text-sm">No graded attempts yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {perQuestion.map((question) => {
                const rate =
                  question.attempted > 0 ? (question.correct / question.attempted) * 100 : 0;
                return (
                  <div key={question.id} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="line-clamp-1">{question.text}</span>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {question.correct}/{question.attempted} correct
                      </span>
                    </div>
                    <div className="bg-muted h-2 overflow-hidden rounded-sm">
                      <div
                        className="bg-primary h-full"
                        style={{ width: `${question.attempted > 0 ? rate : 0}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
