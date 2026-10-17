import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyRazorpayWebhookSignature } from "@/lib/payments/signature";

const SECRET = "test-webhook-secret";
const BODY = JSON.stringify({ event: "payment.captured", payload: { foo: "bar" } });

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyRazorpayWebhookSignature", () => {
  it("accepts a correctly signed body", () => {
    expect(verifyRazorpayWebhookSignature(BODY, sign(BODY, SECRET), SECRET)).toBe(true);
  });

  it("rejects a tampered body signed for different content", () => {
    const signatureForOtherBody = sign(BODY, SECRET);
    const tampered = BODY.replace("bar", "baz");
    expect(verifyRazorpayWebhookSignature(tampered, signatureForOtherBody, SECRET)).toBe(
      false,
    );
  });

  it("rejects a signature produced with the wrong secret", () => {
    expect(verifyRazorpayWebhookSignature(BODY, sign(BODY, "wrong-secret"), SECRET)).toBe(
      false,
    );
  });

  it("rejects a missing signature header", () => {
    expect(verifyRazorpayWebhookSignature(BODY, null, SECRET)).toBe(false);
  });

  it("rejects a malformed (non-hex, wrong-length) signature header without throwing", () => {
    expect(verifyRazorpayWebhookSignature(BODY, "not-valid-hex!!", SECRET)).toBe(false);
    expect(verifyRazorpayWebhookSignature(BODY, "ab", SECRET)).toBe(false);
  });
});
