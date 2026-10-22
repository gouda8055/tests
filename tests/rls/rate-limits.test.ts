import { config as loadEnv } from "dotenv";
import { describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });

// Same skip-gracefully-without-credentials convention as the other RLS
// suites — see tenant-isolation.test.ts for why.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CREDENTIALS_AVAILABLE = Boolean(
  SUPABASE_URL &&
  ANON_KEY &&
  SERVICE_ROLE_KEY &&
  SERVICE_ROLE_KEY !== "sandbox-local-dummy-not-a-real-secret",
);

const RUN_ID = Date.now().toString(36);

/**
 * Stage 9: enrollInCourse/unenrollFromCourse (src/lib/enrollment/
 * actions.ts) gained checkRateLimit("enrollment.create"/"enrollment.
 * delete", 20, 3600, actor.id) calls. checkRateLimit() (src/lib/
 * rate-limit.ts) is a thin wrapper over the check_and_record_rate_limit
 * RPC with bucket = `${action}:${identifier}` — calling that RPC
 * directly, with the exact bucket naming and limits the new code uses,
 * verifies the real integration without needing 21 slow UI round-trips
 * through a browser (no prior stage automated rate-limit testing at the
 * UI/e2e level either — every other bucket has only ever been verified
 * by code review, same as this one, just made live-DB-verifiable here).
 */
describe.skipIf(!CREDENTIALS_AVAILABLE)(
  "Stage 9: enrollment rate limits (0009_rate_limiting.sql's check_and_record_rate_limit)",
  () => {
    const anon: SupabaseClient = createClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    it("allows exactly 20 calls then rejects the 21st, for enrollment.create's bucket shape", async () => {
      const bucket = `enrollment.create:test-${RUN_ID}`;
      for (let i = 0; i < 20; i += 1) {
        const { data, error } = await anon.rpc("check_and_record_rate_limit", {
          p_bucket: bucket,
          p_max_events: 20,
          p_window_seconds: 3600,
        });
        expect(error).toBeNull();
        expect(data).toBe(true);
      }

      const { data: blocked, error } = await anon.rpc("check_and_record_rate_limit", {
        p_bucket: bucket,
        p_max_events: 20,
        p_window_seconds: 3600,
      });
      expect(error).toBeNull();
      expect(blocked).toBe(false);
    });

    it("scopes enrollment.create and enrollment.delete to independent buckets", async () => {
      const createBucket = `enrollment.create:independence-${RUN_ID}`;
      const deleteBucket = `enrollment.delete:independence-${RUN_ID}`;

      for (let i = 0; i < 20; i += 1) {
        await anon.rpc("check_and_record_rate_limit", {
          p_bucket: createBucket,
          p_max_events: 20,
          p_window_seconds: 3600,
        });
      }
      const { data: createBlocked } = await anon.rpc("check_and_record_rate_limit", {
        p_bucket: createBucket,
        p_max_events: 20,
        p_window_seconds: 3600,
      });
      expect(createBlocked).toBe(false);

      // The delete bucket (a different action string, same identifier
      // shape) must still have its own fresh budget.
      const { data: deleteAllowed, error } = await anon.rpc("check_and_record_rate_limit", {
        p_bucket: deleteBucket,
        p_max_events: 20,
        p_window_seconds: 3600,
      });
      expect(error).toBeNull();
      expect(deleteAllowed).toBe(true);
    });
  },
);
