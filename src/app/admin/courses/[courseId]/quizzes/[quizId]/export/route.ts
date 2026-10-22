import { NextResponse } from "next/server";

import { requireTenantRole } from "@/lib/auth/guard";
import { logAudit } from "@/lib/audit/log";
import { stripFormulaPrefix, toCsvRow } from "@/lib/csv";
import { getStudentNames } from "@/lib/courses/student-names";
import { formatDateTime } from "@/lib/format";
import { finalizeExpiredAttempts } from "@/lib/quizzes/grading";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { createServerClient } from "@/lib/supabase/server";

const ATTEMPT_COLUMNS =
  "id, student_id, status, started_at, submitted_at, duration_seconds, grace_seconds, score, max_score";

function sanitizeFilename(title: string): string {
  const cleaned = title.replace(/[^A-Za-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "quiz";
}

/**
 * Gradebook/results export (Stage 4) — same auth (requireTenantRole works
 * in Route Handlers per Next's docs: "redirect can be used while rendering
 * in Server and Client Components, Route Handlers, and Server Functions")
 * and the same data-loading as the attempts page: the same
 * finalizeExpiredAttempts() lazy sweep (so an export never shows a stale
 * in_progress row) and the same getStudentNames() lookup.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ courseId: string; quizId: string }> },
) {
  const actor = await requireTenantRole(["institute_owner", "instructor"]);
  const { courseId, quizId } = await params;

  const allowed = await checkRateLimit("quiz.export", 20, 3600, actor.id);
  if (!allowed) {
    return NextResponse.json({ error: "Too many exports. Try again later." }, { status: 429 });
  }

  const supabase = await createServerClient();
  const { data: quiz } = await supabase
    .from("quizzes")
    .select("id, title")
    .eq("id", quizId)
    .eq("course_id", courseId)
    .maybeSingle();
  if (!quiz) return NextResponse.json({ error: "Quiz not found." }, { status: 404 });

  // SECURITY.md §10: data exports must be audit-logged, same as every
  // other mutating/export-shaped action in this codebase.
  await logAudit({
    instituteId: actor.instituteId,
    actorId: actor.id,
    action: "quiz.exported",
    target: quiz.id,
    metadata: { courseId, quizId: quiz.id },
    ip: await getClientIp(),
  });

  const loadAttempts = () =>
    supabase
      .from("quiz_attempts")
      .select(ATTEMPT_COLUMNS)
      .eq("quiz_id", quiz.id)
      .order("started_at", { ascending: false });

  let { data: attempts } = await loadAttempts();
  if (await finalizeExpiredAttempts(attempts ?? [], actor.id)) {
    ({ data: attempts } = await loadAttempts());
  }

  const attemptList = attempts ?? [];
  const names = actor.instituteId
    ? await getStudentNames(
        actor.instituteId,
        attemptList.map((attempt) => attempt.student_id as string),
      )
    : new Map<string, string>();

  // Every data-row cell is formula-stripped even though these are
  // app-authored names/statuses, not raw student input — SECURITY.md §5's
  // CSV-injection guidance is a blanket rule for anything that becomes a
  // CSV cell, not just user-supplied text.
  const lines = [
    toCsvRow(["Student", "Status", "Score", "Max Score", "Started At", "Submitted At"]),
    ...attemptList.map((attempt) =>
      toCsvRow(
        [
          names.get(attempt.student_id as string) ?? "Unknown student",
          attempt.status as string,
          attempt.score === null ? "" : String(attempt.score),
          attempt.max_score === null ? "" : String(attempt.max_score),
          formatDateTime(attempt.started_at as string | null),
          formatDateTime(attempt.submitted_at as string | null),
        ].map(stripFormulaPrefix),
      ),
    ),
  ];

  // Leading UTF-8 BOM so Excel renders non-ASCII names correctly.
  const csv = `﻿${lines.join("\r\n")}\r\n`;
  const filename = `${sanitizeFilename(quiz.title)}-attempts.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
