import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Pure signature verification — no `server-only`/env dependency, so it's
 * directly unit-testable (tests/unit/payments-signature.test.ts). Used by
 * the webhook route handler (src/app/api/webhooks/razorpay/route.ts),
 * which reads the request body via request.text() (never .json() first —
 * this needs the exact raw bytes, not a reserialized object) and passes it
 * here before trusting anything in it.
 *
 * Verified with Node's built-in crypto rather than the Razorpay SDK's own
 * helper — explicit and auditable, matching this codebase's general
 * preference for visible verification over a library doing it invisibly
 * (see src/lib/csv.ts's stripFormulaPrefix, the RLS amount re-check in
 * 0026_payments.sql, etc.).
 */
export function verifyRazorpayWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string,
): boolean {
  if (!signatureHeader) return false;

  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(signatureHeader, "hex");

  // timingSafeEqual throws on mismatched lengths rather than returning
  // false, and a malformed (non-hex or wrong-length) header is exactly the
  // "reject" case, not a crash.
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}
