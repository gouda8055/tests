import "server-only";
import { z } from "zod";

import { publicEnv } from "@/lib/env";

/**
 * Server-only environment variables. The `server-only` import above makes
 * Next.js throw a build error if any client component chain ever imports
 * this module, so the service-role key cannot leak into a browser bundle.
 */
const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

function parseServerEnv() {
  const parsed = serverEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
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
