import { formatPrice } from "@/lib/format";

/**
 * Pure email-template builders — no `server-only`/env/provider-SDK
 * dependency, so these are directly unit-testable (same reasoning as
 * csv.ts, correctness.ts, signature.ts: pull the testable logic out of
 * whatever module has to be server-only).
 */

/**
 * These are HTML emails, and every interpolated value below (course
 * title, quiz title) is user-authored content, not system text — exactly
 * as real an injection surface as unescaped HTML anywhere else in this
 * app. Every template below escapes its inputs before interpolating.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emailShell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="font-family: sans-serif; color: #111; max-width: 480px; margin: 0 auto; padding: 24px;">
    <h1 style="font-size: 18px;">${title}</h1>
    ${bodyHtml}
  </body>
</html>`;
}

export type EmailContent = { subject: string; html: string };

export function enrollmentConfirmedEmail(params: { courseTitle: string }): EmailContent {
  const courseTitle = escapeHtml(params.courseTitle);
  return {
    subject: `You're enrolled in ${courseTitle}`,
    html: emailShell(
      "You're enrolled",
      `<p>You're enrolled in <strong>${courseTitle}</strong>. Sign in to start learning.</p>`,
    ),
  };
}

export function paymentReceiptEmail(params: {
  courseTitle: string;
  amountPaise: number;
  currency: string;
}): EmailContent {
  const courseTitle = escapeHtml(params.courseTitle);
  const amount = escapeHtml(formatPrice(params.amountPaise, params.currency));
  return {
    subject: `Payment receipt: ${courseTitle}`,
    html: emailShell(
      "Payment received",
      `<p>We received your payment of <strong>${amount}</strong> for <strong>${courseTitle}</strong>, and you're now enrolled.</p>`,
    ),
  };
}

export function quizPublishedEmail(params: {
  courseTitle: string;
  quizTitle: string;
}): EmailContent {
  const courseTitle = escapeHtml(params.courseTitle);
  const quizTitle = escapeHtml(params.quizTitle);
  return {
    subject: `New quiz available: ${quizTitle}`,
    html: emailShell(
      "New quiz available",
      `<p>A new quiz, <strong>${quizTitle}</strong>, is now available in <strong>${courseTitle}</strong>.</p>`,
    ),
  };
}

export function courseCompletedEmail(params: { courseTitle: string }): EmailContent {
  const courseTitle = escapeHtml(params.courseTitle);
  return {
    subject: `You've completed ${courseTitle}`,
    html: emailShell(
      "Congratulations!",
      `<p>You've passed every required quiz in <strong>${courseTitle}</strong>. Your certificate of completion is ready — visit the course page to download it.</p>`,
    ),
  };
}

export function attemptGradedEmail(params: {
  quizTitle: string;
  score: number;
  maxScore: number;
  status: "submitted" | "timed_out";
}): EmailContent {
  const quizTitle = escapeHtml(params.quizTitle);
  const timedOutNote =
    params.status === "timed_out"
      ? "<p>Time ran out, so your saved answers were graded as submitted.</p>"
      : "";
  return {
    subject: `Your result for ${quizTitle}`,
    html: emailShell(
      "Quiz graded",
      `<p>Your attempt at <strong>${quizTitle}</strong> has been graded: <strong>${params.score} / ${params.maxScore}</strong>.</p>${timedOutNote}`,
    ),
  };
}
