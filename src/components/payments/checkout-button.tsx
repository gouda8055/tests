"use client";

import { useEffect, useRef, useState } from "react";

import { createCheckoutOrder, getEnrollmentStatus } from "@/lib/payments/actions";
import { formatPrice } from "@/lib/format";
import { Button } from "@/components/ui/button";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

const CHECKOUT_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 20_000;

type Status =
  | { state: "idle" }
  | { state: "opening" }
  | { state: "confirming" }
  | { state: "error"; message: string };

function loadCheckoutScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${CHECKOUT_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Could not load Razorpay.")));
      return;
    }
    const script = document.createElement("script");
    script.src = CHECKOUT_SCRIPT_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Razorpay."));
    document.body.appendChild(script);
  });
}

/**
 * Razorpay's own client-side success handler (below) is cosmetic only —
 * SECURITY.md §7: "never treat a client redirect as proof of payment."
 * The actual enrollment only ever comes from the signature-verified
 * webhook (src/app/api/webhooks/razorpay/route.ts); this component just
 * polls for it afterward so the UI doesn't look stuck.
 */
export function CheckoutButton({
  courseId,
  pricePaise,
  currency,
  studentName,
}: {
  courseId: string;
  pricePaise: number;
  currency: string;
  studentName?: string | null;
}) {
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  function pollForEnrollment() {
    const startedAt = Date.now();
    pollTimer.current = setInterval(async () => {
      const { enrolled } = await getEnrollmentStatus(courseId);
      if (enrolled) {
        if (pollTimer.current) clearInterval(pollTimer.current);
        window.location.reload();
        return;
      }
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        if (pollTimer.current) clearInterval(pollTimer.current);
        setStatus({
          state: "error",
          message:
            "Payment received, but enrollment is taking longer than expected to confirm. Refresh this page in a minute.",
        });
      }
    }, POLL_INTERVAL_MS);
  }

  async function startCheckout() {
    setStatus({ state: "opening" });
    try {
      await loadCheckoutScript();
    } catch {
      setStatus({ state: "error", message: "Could not load the payment form. Try again." });
      return;
    }

    const result = await createCheckoutOrder(courseId);
    if ("error" in result) {
      setStatus({ state: "error", message: result.error });
      return;
    }
    if (!window.Razorpay) {
      setStatus({ state: "error", message: "Could not load the payment form. Try again." });
      return;
    }

    const razorpay = new window.Razorpay({
      key: result.keyId,
      order_id: result.orderId,
      amount: result.amountPaise,
      currency: result.currency,
      name: "Course enrollment",
      prefill: studentName ? { name: studentName } : undefined,
      handler: () => {
        setStatus({ state: "confirming" });
        pollForEnrollment();
      },
      modal: {
        ondismiss: () => setStatus({ state: "idle" }),
      },
    });
    razorpay.open();
  }

  if (status.state === "confirming") {
    return (
      <p className="text-muted-foreground text-sm">
        Payment received — confirming your enrollment…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {status.state === "error" ? (
        <p className="text-destructive text-sm">{status.message}</p>
      ) : null}
      <Button
        onClick={startCheckout}
        disabled={status.state === "opening"}
        className="self-start"
      >
        {status.state === "opening"
          ? "Opening checkout…"
          : `Buy for ${formatPrice(pricePaise, currency)}`}
      </Button>
    </div>
  );
}
