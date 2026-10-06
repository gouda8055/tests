import { z } from "zod";

/**
 * Client-safe environment variables. Only `NEXT_PUBLIC_*` values belong
 * here — anything else must go in `env.server.ts`, which is guarded by
 * the `server-only` import so it can never end up in a browser bundle.
 *
 * Parsing at module load means a missing/malformed var fails the build
 * or the dev server start, rather than surfacing as a runtime crash.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  // The base domain tenants are subdomains of, e.g. "yourapp.com".
  NEXT_PUBLIC_APP_DOMAIN: z.string().min(1),
});

function parsePublicEnv() {
  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_DOMAIN: process.env.NEXT_PUBLIC_APP_DOMAIN,
  });

  if (!parsed.success) {
    throw new Error(
      `Invalid public environment variables:\n${parsed.error.issues
        .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
        .join("\n")}`,
    );
  }

  return parsed.data;
}

export const publicEnv = parsePublicEnv();
