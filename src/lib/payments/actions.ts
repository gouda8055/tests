"use server";

import Razorpay from "razorpay";

import { requireTenantRole } from "@/lib/auth/guard";
import { logAudit } from "@/lib/audit/log";
import { isRazorpayConfigured, serverEnv } from "@/lib/env.server";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { createServerClient } from "@/lib/supabase/server";
import { courseIdSchema } from "@/lib/validation/courses";

export type CreateCheckoutOrderResult =
  | { error: string }
  | { orderId: string; amountPaise: number; currency: string; keyId: string };

/**
 * Creates a Razorpay order for a priced course and the matching `payments`
 * row (status 'created'). The amount comes **only** from the course's own
 * `price_paise` (SECURITY.md §7: "never trust a price from the client") —
 * `courseId` is the only client input this trusts at all. This is a plain
 * async function, not a `<form>` action: the caller (checkout-button.tsx)
 * needs the structured order back to launch Razorpay's Checkout modal,
 * not a redirect — same convention as attempt-actions.ts's saveAnswer().
 *
 * Granting the enrollment itself never happens here — only the
 * signature-verified webhook (src/app/api/webhooks/razorpay/route.ts)
 * does that, after Razorpay actually confirms the payment.
 */
export async function createCheckoutOrder(
  courseId: string,
): Promise<CreateCheckoutOrderResult> {
  const actor = await requireTenantRole(["student"]);
  if (!actor.instituteId) return { error: "Could not start checkout." };

  if (!isRazorpayConfigured) {
    return { error: "Payments aren't configured for this institute yet." };
  }

  const allowed = await checkRateLimit("payments.create-order", 10, 3600, actor.id);
  if (!allowed) return { error: "Too many attempts. Try again later." };

  const parsed = courseIdSchema.safeParse({ courseId });
  if (!parsed.success) return { error: "Invalid request." };

  const supabase = await createServerClient();
  const { data: course } = await supabase
    .from("courses")
    .select("id, institute_id, status, archived_at, price_paise, currency")
    .eq("id", parsed.data.courseId)
    .maybeSingle();

  if (
    !course ||
    course.institute_id !== actor.instituteId ||
    course.status !== "published" ||
    course.archived_at !== null
  ) {
    return { error: "Course not found." };
  }
  if (!course.price_paise || course.price_paise <= 0) {
    return { error: "This course is free — use the enroll button instead." };
  }

  const { data: existingEnrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", course.id)
    .eq("student_id", actor.id)
    .maybeSingle();
  if (existingEnrollment) return { error: "You're already enrolled in this course." };

  const { data: pendingPayment } = await supabase
    .from("payments")
    .select("id")
    .eq("course_id", course.id)
    .eq("student_id", actor.id)
    .eq("status", "created")
    .maybeSingle();
  if (pendingPayment) {
    return {
      error:
        "You already have a payment in progress for this course. Finish it, or wait a few minutes and try again.",
    };
  }

  const razorpay = new Razorpay({
    key_id: serverEnv.RAZORPAY_KEY_ID!,
    key_secret: serverEnv.RAZORPAY_KEY_SECRET!,
  });

  let orderId: string;
  try {
    const order = await razorpay.orders.create({
      amount: course.price_paise,
      currency: course.currency,
      // Razorpay caps receipt length; course+student ids alone already
      // uniquely identify this attempt without needing anything longer.
      receipt: `c_${course.id}_s_${actor.id}`.slice(0, 40),
      notes: { courseId: course.id, studentId: actor.id },
    });
    orderId = order.id;
  } catch (error) {
    console.error("Razorpay order creation failed:", error);
    return { error: "Could not start checkout. Try again later." };
  }

  const { error: insertError } = await supabase.from("payments").insert({
    institute_id: actor.instituteId,
    course_id: course.id,
    student_id: actor.id,
    razorpay_order_id: orderId,
    amount_paise: course.price_paise,
    currency: course.currency,
  });
  if (insertError) {
    console.error("payments insert failed:", insertError.message);
    return { error: "Could not start checkout. Try again later." };
  }

  await logAudit({
    instituteId: actor.instituteId,
    actorId: actor.id,
    action: "payment.order_created",
    target: orderId,
    metadata: { courseId: course.id, amountPaise: course.price_paise },
    ip: await getClientIp(),
  });

  return {
    orderId,
    amountPaise: course.price_paise,
    currency: course.currency,
    keyId: serverEnv.RAZORPAY_KEY_ID!,
  };
}

/**
 * Polled by checkout-button.tsx after Razorpay's client-side success
 * handler fires — that handler is cosmetic only (SECURITY.md §7: "never
 * treat a client redirect as proof of payment"); this just checks whether
 * the webhook has actually granted the enrollment yet.
 */
export async function getEnrollmentStatus(courseId: string): Promise<{ enrolled: boolean }> {
  const actor = await requireTenantRole(["student"]);

  const parsed = courseIdSchema.safeParse({ courseId });
  if (!parsed.success) return { enrolled: false };

  const supabase = await createServerClient();
  const { data } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", parsed.data.courseId)
    .eq("student_id", actor.id)
    .maybeSingle();

  return { enrolled: Boolean(data) };
}
