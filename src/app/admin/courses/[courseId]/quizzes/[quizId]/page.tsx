import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTenantRole } from "@/lib/auth/guard";
import { canManage } from "@/lib/courses/ownership";
import { formatDuration } from "@/lib/format";
import { archiveQuiz, setQuizStatus, updateQuiz } from "@/lib/quizzes/actions";
import { createServerClient } from "@/lib/supabase/server";
import { QuizForm } from "@/components/quizzes/quiz-form";
import { ActionButtonForm } from "@/components/shared/action-button-form";
import { ConfirmActionDialog } from "@/components/shared/confirm-action-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default async function AdminQuizPage({
  params,
}: {
  params: Promise<{ courseId: string; quizId: string }>;
}) {
  const profile = await requireTenantRole(["institute_owner", "instructor"]);
  const { courseId, quizId } = await params;

  const supabase = await createServerClient();
  const [{ data: course }, { data: quiz }] = await Promise.all([
    supabase.from("courses").select("id, title").eq("id", courseId).maybeSingle(),
    supabase
      .from("quizzes")
      .select(
        "id, course_id, lesson_id, created_by, title, description, status, archived_at, duration_seconds, grace_seconds, max_attempts, randomize_questions, randomize_options, show_answers_after_submit",
      )
      .eq("id", quizId)
      .eq("course_id", courseId)
      .maybeSingle(),
  ]);
  if (!course || !quiz) notFound();

  const [{ data: questions }, { data: lessons }] = await Promise.all([
    supabase
      .from("quiz_questions")
      .select("id, position, question_text, question_type, points, archived_at")
      .eq("quiz_id", quiz.id)
      .order("position", { ascending: true }),
    supabase
      .from("lessons")
      .select("id, title")
      .eq("course_id", course.id)
      .is("archived_at", null)
      .order("position", { ascending: true }),
  ]);

  const editable = canManage(profile, quiz.created_by);
  const questionList = questions ?? [];
  const activeCount = questionList.filter((question) => !question.archived_at).length;
  const nextStatus = quiz.status === "published" ? "draft" : "published";
  const base = `/admin/courses/${course.id}/quizzes/${quiz.id}`;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-8">
      <div>
        <Link
          href={`/admin/courses/${course.id}`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← {course.title}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{quiz.title}</h1>
          <StatusBadge status={quiz.status} archivedAt={quiz.archived_at} />
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          {formatDuration(quiz.duration_seconds)} · {quiz.grace_seconds}s grace ·{" "}
          {quiz.max_attempts} attempt{quiz.max_attempts === 1 ? "" : "s"} allowed
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`${base}/attempts`}>Attempts</Link>
        </Button>
        {editable && !quiz.archived_at ? (
          <>
            <ActionButtonForm
              action={setQuizStatus}
              fields={[
                ["quizId", quiz.id],
                ["status", nextStatus],
              ]}
              label={nextStatus === "published" ? "Publish" : "Unpublish"}
            />
            <ConfirmActionDialog
              action={archiveQuiz}
              fields={[["quizId", quiz.id]]}
              triggerLabel="Archive"
              title="Archive this quiz?"
              description="Students will no longer see it. Existing attempts and scores are kept."
              confirmLabel="Archive quiz"
            />
          </>
        ) : null}
      </div>

      {!editable ? (
        <p className="text-muted-foreground text-sm">
          You can view this quiz, but only its creator or the institute owner can edit it.
        </p>
      ) : null}

      <Tabs defaultValue="questions">
        <TabsList>
          <TabsTrigger value="questions">Questions ({activeCount})</TabsTrigger>
          {editable ? <TabsTrigger value="settings">Settings</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="questions" className="flex flex-col gap-4 pt-2">
          {editable ? (
            <Button asChild size="sm" className="self-start">
              <Link href={`${base}/questions/new`}>Add question</Link>
            </Button>
          ) : null}
          {questionList.length === 0 ? (
            <p className="text-muted-foreground text-sm">No questions yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Question</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Points</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {questionList.map((question) => (
                  <TableRow key={question.id}>
                    <TableCell className="max-w-md">
                      <Link
                        href={`${base}/questions/${question.id}`}
                        className="line-clamp-2 font-medium hover:underline"
                      >
                        {question.question_text}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {question.question_type === "single_choice" ? "Single" : "Multiple"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {Number(question.points)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={question.archived_at ? "archived" : "active"}
                        archivedAt={question.archived_at}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        {editable ? (
          <TabsContent value="settings" className="pt-2">
            <QuizForm
              action={updateQuiz}
              lessons={(lessons ?? []).map((lesson) => ({
                id: lesson.id as string,
                title: lesson.title as string,
              }))}
              quiz={{
                id: quiz.id,
                title: quiz.title,
                description: quiz.description,
                lessonId: quiz.lesson_id,
                durationSeconds: quiz.duration_seconds,
                graceSeconds: quiz.grace_seconds,
                maxAttempts: quiz.max_attempts,
                randomizeQuestions: quiz.randomize_questions,
                randomizeOptions: quiz.randomize_options,
                showAnswersAfterSubmit: quiz.show_answers_after_submit,
              }}
            />
          </TabsContent>
        ) : null}
      </Tabs>
    </main>
  );
}
