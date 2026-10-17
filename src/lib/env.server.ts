import "server-only";
import { z } from "zod";

import { publicEnv } from "@/lib/env";

/**
 * Server-only environment variables. The `server-only` import above makes
 * Next.js throw a build error if any client component chain ever imports
 * this module, so the service-role key cannot leak into a browser bundle.
 */
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // Bunny Stream (SECURITY.md §6). All optional: video playback stays
  // dormant, with a clear user-facing message, until an institute's Bunny
  // account is configured. None of these may ever be NEXT_PUBLIC_.
  BUNNY_STREAM_LIBRARY_ID: optionalString,
  BUNNY_STREAM_API_KEY: optionalString,
  BUNNY_STREAM_TOKEN_AUTH_KEY: optionalString,
  BUNNY_STREAM_CDN_HOSTNAME: optionalString,
  // Vercel Cron (Stage 3 quiz-attempt auto-expiry). Optional: the cron
  // route refuses to run until this is set, rather than running
  // unauthenticated — same "dormant until configured" treatment as Bunny
  // above. Vercel sends `Authorization: Bearer ${CRON_SECRET}` automatically
  // on scheduled invocations once this env var exists on the project.
  CRON_SECRET: optionalString,
  // Razorpay (Stage 6 paid enrollment, SECURITY.md §7). All optional:
  // checkout stays dormant, with a clear user-facing message, until an
  // institute's Razorpay account is configured — same treatment as Bunny
  // above. KEY_ID is safe to expose client-side per Razorpay's own docs,
  // but it's still read here (not NEXT_PUBLIC_) and passed explicitly to
  // the client component as a prop, so there's one source of truth
  // alongside the two secrets it belongs with.
  RAZORPAY_KEY_ID: optionalString,
  RAZORPAY_KEY_SECRET: optionalString,
  RAZORPAY_WEBHOOK_SECRET: optionalString,
  // Resend (Stage 7 email notifications). Optional: every send degrades
  // to a logged no-op, never an action failure — see
  // src/lib/notifications/resend.ts. Unlike Bunny/Razorpay, the *feature*
  // isn't user-facing-dormant (there's no button that says "not
  // configured"); the actions these are attached to (enroll, publish,
  // submit) always succeed regardless of whether email is set up.
  RESEND_API_KEY: optionalString,
  EMAIL_FROM: optionalString,
});

function parseServerEnv() {
  const parsed = serverEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    BUNNY_STREAM_LIBRARY_ID: process.env.BUNNY_STREAM_LIBRARY_ID,
    BUNNY_STREAM_API_KEY: process.env.BUNNY_STREAM_API_KEY,
    BUNNY_STREAM_TOKEN_AUTH_KEY: process.env.BUNNY_STREAM_TOKEN_AUTH_KEY,
    BUNNY_STREAM_CDN_HOSTNAME: process.env.BUNNY_STREAM_CDN_HOSTNAME,
    CRON_SECRET: process.env.CRON_SECRET,
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
  });

  if (!parsed.success) {
    throw new Error(
      `Invalid server environment variables:\n${parsed.error.issues
        .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
        .join("\n")}`,
    );
  }

  return parsed.data;
}

export const serverEnv = {
  ...publicEnv,
  ...parseServerEnv(),
};

/**
 * Signed playback needs only the library id and the token-auth key. The API
 * key (uploads/management) and CDN hostname (direct HLS/thumbnails) are
 * accepted now so the env shape is stable, but nothing in this stage
 * requires them.
 */
export const isBunnyConfigured = Boolean(
  serverEnv.BUNNY_STREAM_LIBRARY_ID && serverEnv.BUNNY_STREAM_TOKEN_AUTH_KEY,
);

/** Checkout and the webhook both stay dormant until all three are set. */
export const isRazorpayConfigured = Boolean(
  serverEnv.RAZORPAY_KEY_ID &&
    serverEnv.RAZORPAY_KEY_SECRET &&
    serverEnv.RAZORPAY_WEBHOOK_SECRET,
);

export const isResendConfigured = Boolean(
  serverEnv.RESEND_API_KEY && serverEnv.EMAIL_FROM,
);
