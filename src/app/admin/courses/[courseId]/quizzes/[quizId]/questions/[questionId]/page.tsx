import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTenantRole } from "@/lib/auth/guard";
import { canManage } from "@/lib/courses/ownership";
import { archiveQuestion, updateQuestion } from "@/lib/quizzes/actions";
import { createServerClient } from "@/lib/supabase/server";
import { QuestionForm } from "@/components/quizzes/question-form";
import { ConfirmActionDialog } from "@/components/shared/confirm-action-dialog";
import { Markdown } from "@/components/shared/markdown";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AdminQuestionPage({
  params,
}: {
  params: Promise<{ courseId: string; quizId: string; questionId: string }>;
}) {
  const profile = await requireTenantRole(["institute_owner", "instructor"]);
  const { courseId, quizId, questionId } = await params;

  const supabase = await createServerClient();
  const [{ data: quiz }, { data: question }] = await Promise.all([
    supabase
      .from("quizzes")
      .select("id, course_id, title, created_by")
      .eq("id", quizId)
      .eq("course_id", courseId)
      .maybeSingle(),
    supabase
      .from("quiz_questions")
      .select("id, quiz_id, question_text, question_type, points, archived_at")
      .eq("id", questionId)
      .eq("quiz_id", quizId)
      .maybeSingle(),
  ]);
  if (!quiz || !question) notFound();

  // The answer key is read through the session client: 0015's staff-only
  // select policy returns it only to the quiz's creator or the owner.
  const [{ data: options }, { data: answerKey }] = await Promise.all([
    supabase
      .from("quiz_question_options")
      .select("id, option_text, position")
      .eq("question_id", question.id)
      .order("position", { ascending: true }),
    supabase
      .from("quiz_answer_keys")
      .select("correct_option_ids, explanation")
      .eq("question_id", question.id)
      .maybeSingle(),
  ]);

  const editable = canManage(profile, quiz.created_by);
  const correct = new Set<string>(
    (answerKey?.correct_option_ids as string[] | null) ?? [],
  );
  const optionList = (options ?? []).map((option) => ({
    id: option.id as string,
    text: option.option_text as string,
    correct: correct.has(option.id as string),
  }));

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <div>
        <Link
          href={`/admin/courses/${quiz.course_id}/quizzes/${quiz.id}`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← {quiz.title}
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-xl font-semibold">Question</h1>
          {question.archived_at ? (
            <StatusBadge status="archived" archivedAt={question.archived_at} />
          ) : null}
        </div>
      </div>

      {editable && !question.archived_at ? (
        <>
          <div>
            <ConfirmActionDialog
              action={archiveQuestion}
              fields={[["questionId", question.id]]}
              triggerLabel="Archive question"
              title="Archive this question?"
              description="It is removed from new attempts, and attempts in progress no longer score it."
              confirmLabel="Archive question"
            />
          </div>
          <Card>
            <CardContent className="pt-6">
              <QuestionForm
                action={updateQuestion}
                question={{
                  id: question.id,
                  questionText: question.question_text,
                  questionType: question.question_type,
                  points: Number(question.points),
                  explanation: (answerKey?.explanation as string | null) ?? null,
                  options: optionList,
                }}
              />
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {question.question_type === "single_choice"
                ? "Single choice"
                : "Multiple choice"}{" "}
              · {Number(question.points)} pt
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Markdown content={question.question_text} />
            <ul className="flex flex-col gap-1 text-sm">
              {optionList.map((option) => (
                <li key={option.id}>
                  {option.text}
                  {option.correct ? (
                    <span className="ml-2 text-green-700">(correct)</span>
                  ) : null}
                </li>
              ))}
            </ul>
            {!answerKey ? (
              <p className="text-muted-foreground text-xs">
                The answer key is visible only to this quiz&apos;s creator and the
                institute owner.
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
