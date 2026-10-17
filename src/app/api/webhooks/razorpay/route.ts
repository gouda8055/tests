import { NextResponse } from "next/server";

import { isRazorpayConfigured, serverEnv } from "@/lib/env.server";
import { logAudit } from "@/lib/audit/log";
import { notifyPaymentCaptured } from "@/lib/notifications/send";
import { verifyRazorpayWebhookSignature } from "@/lib/payments/signature";
import { createAdminClient } from "@/lib/supabase/admin";

type RazorpayPaymentEntity = {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
};

type RazorpayWebhookBody = {
  event: string;
  payload?: {
    payment?: {
      entity?: RazorpayPaymentEntity;
    };
  };
};

/**
 * Razorpay webhook (Stage 6, SECURITY.md §7): "grant access only from a
 * signature-verified webhook." No user session here at all — this is
 * Razorpay's server calling us — so every write uses the service-role
 * client, and nothing in the body is trusted until the signature over the
 * exact raw bytes checks out.
 */
export async function POST(request: Request) {
  if (!isRazorpayConfigured) {
    return NextResponse.json({ error: "Razorpay is not configured." }, { status: 500 });
  }

  // .text() first, never .json() first — signature verification needs the
  // exact raw bytes Razorpay signed, not a reserialized object that could
  // differ in whitespace/key order.
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature");
  const verified = verifyRazorpayWebhookSignature(
    rawBody,
    signature,
    serverEnv.RAZORPAY_WEBHOOK_SECRET!,
  );
  if (!verified) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  let body: RazorpayWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const payment = body.payload?.payment?.entity;

  if (body.event === "payment.captured" && payment) {
    await handleCaptured(payment);
  } else if (body.event === "payment.failed" && payment) {
    await handleFailed(payment);
  }
  // Any other event: 200, no-op — Razorpay sends many event types we
  // don't act on, and retrying those forever would help nothing.

  return NextResponse.json({ ok: true });
}

async function handleCaptured(payment: RazorpayPaymentEntity): Promise<void> {
  const admin = createAdminClient();

  const { data: paymentRow } = await admin
    .from("payments")
    .select(
      "id, institute_id, course_id, student_id, status, amount_paise, currency, courses(title)",
    )
    .eq("razorpay_order_id", payment.order_id)
    .maybeSingle();

  if (!paymentRow) {
    console.error("Razorpay webhook: no payments row for order", payment.order_id);
    return;
  }
  // Idempotent: a payment this webhook already processed is a no-op, not
  // a re-grant — SECURITY.md §7's "webhook handlers MUST be idempotent."
  if (paymentRow.status === "captured") return;

  // Re-verify amount/currency against what we actually created the order
  // for, not just what Razorpay's payload claims — belt and suspenders
  // alongside the RLS check on the original insert.
  if (
    payment.amount !== paymentRow.amount_paise ||
    payment.currency !== paymentRow.currency
  ) {
    console.error(
      "Razorpay webhook: amount/currency mismatch for order",
      payment.order_id,
    );
    return;
  }

  const { error: updateError } = await admin
    .from("payments")
    .update({
      status: "captured",
      razorpay_payment_id: payment.id,
      captured_at: new Date().toISOString(),
    })
    .eq("id", paymentRow.id)
    .eq("status", "created"); // guards against a concurrent duplicate delivery
  if (updateError) {
    console.error("Razorpay webhook: failed to mark payment captured:", updateError.message);
    return;
  }

  const { error: enrollError } = await admin.from("enrollments").insert({
    institute_id: paymentRow.institute_id,
    course_id: paymentRow.course_id,
    student_id: paymentRow.student_id,
  });
  // A unique-violation here means the student is already enrolled (e.g. a
  // retried delivery after the first succeeded) — not a real failure.
  if (enrollError && enrollError.code !== "23505") {
    console.error("Razorpay webhook: failed to create enrollment:", enrollError.message);
    return;
  }

  await logAudit({
    instituteId: paymentRow.institute_id,
    actorId: paymentRow.student_id,
    action: "payment.captured",
    target: paymentRow.id,
    metadata: { courseId: paymentRow.course_id, razorpayPaymentId: payment.id },
    ip: null,
  });

  const course = paymentRow.courses as unknown as { title: string } | null;
  if (course) {
    await notifyPaymentCaptured({
      studentId: paymentRow.student_id,
      courseTitle: course.title,
      amountPaise: paymentRow.amount_paise,
      currency: paymentRow.currency,
    });
  }
}

async function handleFailed(payment: RazorpayPaymentEntity): Promise<void> {
  const admin = createAdminClient();

  const { data: paymentRow } = await admin
    .from("payments")
    .select("id, institute_id, course_id, student_id, status")
    .eq("razorpay_order_id", payment.order_id)
    .maybeSingle();
  if (!paymentRow || paymentRow.status !== "created") return;

  const { error } = await admin
    .from("payments")
    .update({ status: "failed", razorpay_payment_id: payment.id })
    .eq("id", paymentRow.id)
    .eq("status", "created");
  if (error) {
    console.error("Razorpay webhook: failed to mark payment failed:", error.message);
    return;
  }

  await logAudit({
    instituteId: paymentRow.institute_id,
    actorId: paymentRow.student_id,
    action: "payment.failed",
    target: paymentRow.id,
    metadata: { courseId: paymentRow.course_id, razorpayPaymentId: payment.id },
    ip: null,
  });
}
