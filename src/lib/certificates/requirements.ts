import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type QuizRequirement = {
  quizId: string;
  quizTitle: string;
  passingScorePercent: number;
  passed: boolean;
};

/**
 * The single source of truth for "has this student completed this
 * course," used by both the completion-check that issues a certificate
 * (src/lib/certificates/completion.ts) and the student-facing progress
 * page — factored out so the two can never drift apart.
 *
 * Only quizzes with passing_score_percent set count; a course with none
 * returns an empty array ("nothing to complete yet"). Percentage-based
 * (not raw score), same reasoning as Stage 5's analytics page: pool_size
 * means max_score isn't constant across a quiz's own attempts, let alone
 * across different quizzes.
 *
 * Admin client throughout (not session-scoped): this needs to run
 * identically whether called from the student's own session (the
 * progress page) or from finalizeIfExpired's service-role context (the
 * completion check) — one code path, not two that could disagree.
 */
export async function getCourseCompletionRequirements(
  courseId: string,
  studentId: string,
): Promise<QuizRequirement[]> {
  const admin = createAdminClient();
  const { data: quizzes } = await admin
    .from("quizzes")
    .select("id, title, passing_score_percent")
    .eq("course_id", courseId)
    .eq("status", "published")
    .is("archived_at", null)
    .not("passing_score_percent", "is", null);

  const requiredQuizzes = quizzes ?? [];
  if (requiredQuizzes.length === 0) return [];

  const { data: attempts } = await admin
    .from("quiz_attempts")
    .select("quiz_id, score, max_score, status")
    .in(
      "quiz_id",
      requiredQuizzes.map((quiz) => quiz.id as string),
    )
    .eq("student_id", studentId)
    .in("status", ["submitted", "timed_out"]);

  const bestPercentByQuiz = new Map<string, number>();
  for (const attempt of attempts ?? []) {
    const maxScore = Number(attempt.max_score);
    if (maxScore <= 0) continue;
    const percent = (Number(attempt.score) / maxScore) * 100;
    const quizId = attempt.quiz_id as string;
    const current = bestPercentByQuiz.get(quizId) ?? -1;
    if (percent > current) bestPercentByQuiz.set(quizId, percent);
  }

  return requiredQuizzes.map((quiz) => {
    const quizId = quiz.id as string;
    const passingScorePercent = Number(quiz.passing_score_percent);
    const bestPercent = bestPercentByQuiz.get(quizId) ?? 0;
    return {
      quizId,
      quizTitle: quiz.title as string,
      passingScorePercent,
      passed: bestPercent >= passingScorePercent,
    };
  });
}
