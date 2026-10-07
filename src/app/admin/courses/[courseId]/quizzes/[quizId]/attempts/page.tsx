import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTenantRole } from "@/lib/auth/guard";
import { getStudentNames } from "@/lib/courses/student-names";
import { formatDateTime, formatScore } from "@/lib/format";
import { finalizeExpiredAttempts } from "@/lib/quizzes/grading";
import { createServerClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/shared/status-badge";
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
  "id, student_id, status, started_at, submitted_at, duration_seconds, grace_seconds, score, max_score";

export default async function QuizAttemptsPage({
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

  // Staff may see attempts at any status (0016's select policy).
  const loadAttempts = () =>
    supabase
      .from("quiz_attempts")
      .select(ATTEMPT_COLUMNS)
      .eq("quiz_id", quiz.id)
      .order("started_at", { ascending: false });

  let { data: attempts } = await loadAttempts();

  // Lazily finalize any attempt whose deadline has passed, so this list
  // never shows a stale "in progress" (there's no background job).
  if (await finalizeExpiredAttempts(attempts ?? [], profile.id)) {
    ({ data: attempts } = await loadAttempts());
  }

  const attemptList = attempts ?? [];
  const names = profile.instituteId
    ? await getStudentNames(
        profile.instituteId,
        attemptList.map((attempt) => attempt.student_id as string),
      )
    : new Map<string, string>();
  const base = `/admin/courses/${quiz.course_id}/quizzes/${quiz.id}`;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-8">
      <div>
        <Link href={base} className="text-muted-foreground text-sm hover:underline">
          ← {quiz.title}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Attempts</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            {attemptList.length} attempt{attemptList.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {attemptList.length === 0 ? (
            <p className="text-muted-foreground text-sm">No attempts yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attemptList.map((attempt) => (
                  <TableRow key={attempt.id}>
                    <TableCell>
                      <Link
                        href={`${base}/attempts/${attempt.id}`}
                        className="font-medium hover:underline"
                      >
                        {names.get(attempt.student_id as string) ?? "Unknown student"}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={attempt.status} />
                    </TableCell>
                    <TableCell>{formatScore(attempt.score, attempt.max_score)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(attempt.started_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(attempt.submitted_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
