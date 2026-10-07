import "server-only";
import { createClient } from "@supabase/supabase-js";

import { publicEnv } from "@/lib/env";
import { getClientIp } from "@/lib/request-ip";

/**
 * Rate-limits an action by client IP, via the check_and_record_rate_limit
 * Postgres function (supabase/migrations/0009_rate_limiting.sql).
 * SECURITY.md §3: "Rate-limit login, signup, password reset and OTP
 * sending."
 *
 * Uses a plain anon-key client — no session/cookies needed, and no
 * service role either: the DB function is deliberately grantable to
 * anon for exactly this purpose (see the migration).
 *
 * Fails OPEN on an infra error (unlike tenant resolution's fail-closed
 * design): a rate-limit check that can't run shouldn't lock every user
 * out of signing in. The error is still logged loudly.
 */
export async function checkRateLimit(
  action: string,
  maxEvents: number,
  windowSeconds: number,
  identifier?: string,
): Promise<boolean> {
  const ip = (await getClientIp()) ?? "unknown";
  const bucket = `${action}:${identifier ?? ip}`;

  const supabase = createClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  const { data, error } = await supabase.rpc("check_and_record_rate_limit", {
    p_bucket: bucket,
    p_max_events: maxEvents,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    console.error(
      `Rate limit check failed for bucket "${bucket}", allowing request:`,
      error.message,
    );
    return true;
  }

  return data === true;
}
