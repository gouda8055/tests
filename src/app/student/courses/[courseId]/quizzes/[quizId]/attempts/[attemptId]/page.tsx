import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireTenantRole } from "@/lib/auth/guard";
import {
  finalizeIfExpired,
  msUntilTimeLimit,
  orderOptions,
  parseQuestionOrder,
} from "@/lib/quizzes/grading";
import { createServerClient } from "@/lib/supabase/server";
import { AttemptRunner, type RunnerQuestion } from "@/components/quizzes/attempt-runner";
import { Markdown } from "@/components/shared/markdown";

export default async function StudentAttemptPage({
  params,
}: {
  params: Promise<{ courseId: string; quizId: string; attemptId: string }>;
}) {
  const profile = await requireTenantRole(["student"]);
  const { courseId, quizId, attemptId } = await params;

  const supabase = await createServerClient();
  const [{ data: quiz }, { data: attempt }] = await Promise.all([
    supabase
      .from("quizzes")
      .select("id, course_id, title")
      .eq("id", quizId)
      .eq("course_id", courseId)
      .maybeSingle(),
    supabase
      .from("quiz_attempts")
      .select(
        "id, quiz_id, status, started_at, duration_seconds, question_order, option_order",
      )
      .eq("id", attemptId)
      .eq("quiz_id", quizId)
      .eq("student_id", profile.id)
      .maybeSingle(),
  ]);
  if (!quiz || !attempt) notFound();

  const resultPath = `/student/courses/${quiz.course_id}/quizzes/${quiz.id}/attempts/${attempt.id}/result`;
  if (attempt.status !== "in_progress") redirect(resultPath);

  const state = await finalizeIfExpired(attempt.id as string, { actorId: profile.id });
  if (!state || state.status !== "in_progress") redirect(resultPath);

  // Questions/options come through the session client (0014: readable by an
  // enrolled student). Correct answers live only in quiz_answer_keys, which
  // has no student policy, so nothing here can carry them.
  const questionIds = parseQuestionOrder(attempt.question_order);
  const [{ data: questions }, { data: options }, { data: answers }] = await Promise.all([
    supabase
      .from("quiz_questions")
      .select("id, question_text, question_type, points")
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
  ]);

  const questionById = new Map((questions ?? []).map((q) => [q.id as string, q]));
  // Archived (or otherwise unresolvable) IDs in question_order are skipped.
  const runnerQuestions: RunnerQuestion[] = questionIds.flatMap((id) => {
    const question = questionById.get(id);
    if (!question) return [];
    return [
      {
        id,
        type: question.question_type as RunnerQuestion["type"],
        points: Number(question.points),
        body: <Markdown content={question.question_text as string} />,
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
      },
    ];
  });

  const initialAnswers: Record<string, string[]> = {};
  for (const answer of answers ?? []) {
    initialAnswers[answer.question_id as string] =
      (answer.selected_option_ids as string[]) ?? [];
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-8">
      <div>
        <Link
          href={`/student/courses/${quiz.course_id}/quizzes/${quiz.id}`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← {quiz.title}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{quiz.title}</h1>
      </div>
      <AttemptRunner
        attemptId={attempt.id as string}
        questions={runnerQuestions}
        initialAnswers={initialAnswers}
        remainingMs={msUntilTimeLimit(attempt)}
      />
    </main>
  );
}
