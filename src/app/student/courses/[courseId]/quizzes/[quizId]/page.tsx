import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTenantRole } from "@/lib/auth/guard";
import { formatDateTime, formatDuration, formatScore } from "@/lib/format";
import { finalizeExpiredAttempts } from "@/lib/quizzes/grading";
import { createServerClient } from "@/lib/supabase/server";
import { StartAttemptForm } from "@/components/quizzes/start-attempt-form";
import { Markdown } from "@/components/shared/markdown";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const ATTEMPT_COLUMNS =
  "id, status, started_at, submitted_at, duration_seconds, grace_seconds, score, max_score";

export default async function StudentQuizPage({
  params,
}: {
  params: Promise<{ courseId: string; quizId: string }>;
}) {
  const profile = await requireTenantRole(["student"]);
  const { courseId, quizId } = await params;

  const supabase = await createServerClient();
  const { data: quiz } = await supabase
    .from("quizzes")
    .select("id, course_id, title, description, duration_seconds, max_attempts")
    .eq("id", quizId)
    .eq("course_id", courseId)
    .maybeSingle();
  if (!quiz) notFound();

  const loadAttempts = () =>
    supabase
      .from("quiz_attempts")
      .select(ATTEMPT_COLUMNS)
      .eq("quiz_id", quiz.id)
      .eq("student_id", profile.id)
      .order("started_at", { ascending: false });

  let { data: attempts } = await loadAttempts();
  if (await finalizeExpiredAttempts(attempts ?? [], profile.id)) {
    ({ data: attempts } = await loadAttempts());
  }

  const attemptList = attempts ?? [];
  const live = attemptList.find((attempt) => attempt.status === "in_progress");
  const remainingAttempts = Math.max(0, quiz.max_attempts - attemptList.length);
  const base = `/student/courses/${quiz.course_id}/quizzes/${quiz.id}`;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <div>
        <Link
          href={`/student/courses/${quiz.course_id}`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Back to course
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{quiz.title}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {formatDuration(quiz.duration_seconds)} · {remainingAttempts} of{" "}
            {quiz.max_attempts} attempt{quiz.max_attempts === 1 ? "" : "s"} remaining
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {quiz.description ? <Markdown content={quiz.description} /> : null}
          <p className="text-muted-foreground text-sm">
            The timer starts as soon as you begin and keeps running if you leave the page.
            Answers save automatically; when time runs out the attempt is submitted with
            whatever was saved.
          </p>
          {live ? (
            <Button asChild className="self-start">
              <Link href={`${base}/attempts/${live.id}`}>Resume attempt</Link>
            </Button>
          ) : remainingAttempts > 0 ? (
            <StartAttemptForm
              quizId={quiz.id}
              label={attemptList.length === 0 ? "Start quiz" : "Start another attempt"}
            />
          ) : (
            <p className="text-sm">You&apos;ve used all your attempts for this quiz.</p>
          )}
        </CardContent>
      </Card>

      {attemptList.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Your attempts</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attemptList.map((attempt) => (
                  <TableRow key={attempt.id}>
                    <TableCell>{formatDateTime(attempt.started_at)}</TableCell>
                    <TableCell>
                      <StatusBadge status={attempt.status} />
                    </TableCell>
                    <TableCell>{formatScore(attempt.score, attempt.max_score)}</TableCell>
                    <TableCell>
                      <Link
                        href={
                          attempt.status === "in_progress"
                            ? `${base}/attempts/${attempt.id}`
                            : `${base}/attempts/${attempt.id}/result`
                        }
                        className="text-sm hover:underline"
                      >
                        {attempt.status === "in_progress" ? "Resume" : "View result"}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
