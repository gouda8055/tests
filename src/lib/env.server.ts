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
});

function parseServerEnv() {
  const parsed = serverEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    BUNNY_STREAM_LIBRARY_ID: process.env.BUNNY_STREAM_LIBRARY_ID,
    BUNNY_STREAM_API_KEY: process.env.BUNNY_STREAM_API_KEY,
    BUNNY_STREAM_TOKEN_AUTH_KEY: process.env.BUNNY_STREAM_TOKEN_AUTH_KEY,
    BUNNY_STREAM_CDN_HOSTNAME: process.env.BUNNY_STREAM_CDN_HOSTNAME,
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
