import "server-only";

import { getUserEmails } from "@/lib/notifications/recipients";
import { sendEmail } from "@/lib/notifications/resend";
import {
  attemptGradedEmail,
  enrollmentConfirmedEmail,
  paymentReceiptEmail,
  quizPublishedEmail,
} from "@/lib/notifications/templates";

/**
 * One orchestration function per event, each called from exactly one
 * trigger site (see HANDOFF.md's Stage 7 section for the list). Every
 * function here wraps its whole body in try/catch and never rethrows —
 * sendEmail() below already never throws on its own, but the recipient
 * lookup is a DB call that could, and a notification failing must never
 * surface as the calling action (enroll/publish/submit) failing.
 */

export async function notifyEnrollmentConfirmed(params: {
  studentId: string;
  courseTitle: string;
}): Promise<void> {
  try {
    const to = (await getUserEmails([params.studentId])).get(params.studentId);
    if (!to) return;
    const { subject, html } = enrollmentConfirmedEmail({ courseTitle: params.courseTitle });
    await sendEmail({ to, subject, html });
  } catch (error) {
    console.error("notifyEnrollmentConfirmed failed:", error);
  }
}

export async function notifyPaymentCaptured(params: {
  studentId: string;
  courseTitle: string;
  amountPaise: number;
  currency: string;
}): Promise<void> {
  try {
    const to = (await getUserEmails([params.studentId])).get(params.studentId);
    if (!to) return;
    const { subject, html } = paymentReceiptEmail({
      courseTitle: params.courseTitle,
      amountPaise: params.amountPaise,
      currency: params.currency,
    });
    await sendEmail({ to, subject, html });
  } catch (error) {
    console.error("notifyPaymentCaptured failed:", error);
  }
}

/** Loops synchronously over a course's enrolled students — no queue/batching this stage. */
export async function notifyQuizPublished(params: {
  studentIds: string[];
  courseTitle: string;
  quizTitle: string;
}): Promise<void> {
  try {
    if (params.studentIds.length === 0) return;
    const emails = await getUserEmails(params.studentIds);
    const { subject, html } = quizPublishedEmail({
      courseTitle: params.courseTitle,
      quizTitle: params.quizTitle,
    });
    await Promise.all([...emails.values()].map((to) => sendEmail({ to, subject, html })));
  } catch (error) {
    console.error("notifyQuizPublished failed:", error);
  }
}

export async function notifyAttemptGraded(params: {
  studentId: string;
  quizTitle: string;
  score: number;
  maxScore: number;
  status: "submitted" | "timed_out";
}): Promise<void> {
  try {
    const to = (await getUserEmails([params.studentId])).get(params.studentId);
    if (!to) return;
    const { subject, html } = attemptGradedEmail({
      quizTitle: params.quizTitle,
      score: params.score,
      maxScore: params.maxScore,
      status: params.status,
    });
    await sendEmail({ to, subject, html });
  } catch (error) {
    console.error("notifyAttemptGraded failed:", error);
  }
}
