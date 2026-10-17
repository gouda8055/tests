import "server-only";

import { getCourseCompletionRequirements } from "@/lib/certificates/requirements";
import { notifyCourseCompleted } from "@/lib/notifications/send";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Called from finalizeIfExpired (src/lib/quizzes/grading.ts), right after
 * an attempt is graded — the natural moment a course might newly become
 * complete. No new idempotency mechanism needed: the unique constraint on
 * (course_id, student_id) already makes a repeat check a safe no-op (a
 * unique-violation here means "already issued," not a real failure —
 * same idiom the Razorpay webhook already uses for its own duplicate-
 * delivery case). Wrapped in try/catch and never rethrown, same "never
 * block the real action" rule every notification-adjacent call in this
 * codebase follows: a certificate failing to issue must never fail the
 * grading it's riding on.
 */
export async function checkAndIssueCertificate(params: {
  instituteId: string;
  courseId: string;
  studentId: string;
}): Promise<void> {
  try {
    const requirements = await getCourseCompletionRequirements(
      params.courseId,
      params.studentId,
    );
    // Empty means the course has no quiz marked as counting yet — nothing
    // to complete. Any unpassed requirement means not complete yet either.
    if (requirements.length === 0 || !requirements.every((req) => req.passed)) {
      return;
    }

    const admin = createAdminClient();
    const { data: inserted, error } = await admin
      .from("certificates")
      .insert({
        institute_id: params.instituteId,
        course_id: params.courseId,
        student_id: params.studentId,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      if (error.code === "23505") return; // already issued
      console.error("checkAndIssueCertificate: insert failed:", error.message);
      return;
    }
    if (!inserted) return;

    const { data: course } = await admin
      .from("courses")
      .select("title")
      .eq("id", params.courseId)
      .maybeSingle();
    if (course) {
      await notifyCourseCompleted({
        studentId: params.studentId,
        courseTitle: course.title as string,
      });
    }
  } catch (error) {
    console.error("checkAndIssueCertificate failed:", error);
  }
}
