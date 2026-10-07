import { config as loadEnv } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });

// Requires real Supabase credentials (a project with migrations 0001-0009
// applied) — skips gracefully rather than failing when they're absent, so
// `pnpm test` stays green in environments that haven't configured them
// (e.g. this repo's own CI sandbox, which can't reach *.supabase.co at
// all). Point SUPABASE_SERVICE_ROLE_KEY at a real project's key to run
// this for real. Never point it at a production project — these tests
// create and delete real rows.
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

type Fixture = {
  instituteId: string;
  userId: string;
  client: SupabaseClient;
};

// Note: describe.skipIf still *evaluates* this callback to register the
// suite's structure — it only skips running the `it()` bodies. Anything
// that would throw when credentials are absent (like constructing a
// client with an empty key) must live inside beforeAll/it, never at the
// top level of the describe callback.
describe.skipIf(!CREDENTIALS_AVAILABLE)(
  "RLS: cross-tenant isolation (SECURITY.md §1)",
  () => {
    let admin: SupabaseClient;
    let a: Fixture;
    let b: Fixture;

    async function createFixture(label: "a" | "b"): Promise<Fixture> {
      const subdomain = `rls-test-${label}-${RUN_ID}`;
      const email = `rls-test-${label}-${RUN_ID}@example.com`;
      const password = "correctHorse1Battery";

      const { data: institute, error: instituteError } = await admin
        .from("institutes")
        .insert({ name: `RLS Test ${label.toUpperCase()}`, subdomain })
        .select("id")
        .single();
      if (instituteError || !institute) {
        throw new Error(`fixture institute ${label} failed: ${instituteError?.message}`);
      }

      const { data: created, error: userError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (userError || !created.user) {
        throw new Error(`fixture user ${label} failed: ${userError?.message}`);
      }

      const { error: profileError } = await admin.from("profiles").insert({
        id: created.user.id,
        institute_id: institute.id,
        role: "student",
        full_name: `RLS Test ${label.toUpperCase()}`,
      });
      if (profileError) {
        throw new Error(`fixture profile ${label} failed: ${profileError.message}`);
      }

      const client = createClient(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInError } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        throw new Error(`fixture sign-in ${label} failed: ${signInError.message}`);
      }

      return { instituteId: institute.id, userId: created.user.id, client };
    }

    beforeAll(async () => {
      admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      a = await createFixture("a");
      b = await createFixture("b");
    }, 30_000);

    afterAll(async () => {
      for (const fixture of [a, b]) {
        if (!fixture) continue;
        const { error: auditError } = await admin
          .from("audit_logs")
          .delete()
          .eq("institute_id", fixture.instituteId);
        if (auditError) {
          console.warn(`cleanup: audit_logs delete failed for ${fixture.instituteId}: ${auditError.message}`);
        }

        // Delete the profile directly instead of relying on deleteUser's
        // cascade to land before the institutes delete below: that cascade
        // runs in the Auth system, not this transaction, so there's no
        // guarantee it's visible yet. institutes.profiles_institute_id_fkey
        // is RESTRICT, so any lag here silently orphans the institute row
        // (reproduced: a leaked "rls-test-a-*" institute from this exact race).
        const { error: profileError } = await admin
          .from("profiles")
          .delete()
          .eq("id", fixture.userId);
        if (profileError) {
          console.warn(`cleanup: profile delete failed for ${fixture.userId}: ${profileError.message}`);
        }

        const { error: instituteError } = await admin
          .from("institutes")
          .delete()
          .eq("id", fixture.instituteId);
        if (instituteError) {
          console.warn(`cleanup: institute delete failed for ${fixture.instituteId}: ${instituteError.message}`);
        }

        const { error: userError } = await admin.auth.admin.deleteUser(fixture.userId);
        if (userError) {
          console.warn(`cleanup: auth user delete failed for ${fixture.userId}: ${userError.message}`);
        }
      }
    }, 30_000);

    it("a student can SELECT their own institute's row", async () => {
      const { data, error } = await a.client
        .from("institutes")
        .select("id")
        .eq("id", a.instituteId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("a student cannot SELECT another institute's row", async () => {
      const { data, error } = await a.client
        .from("institutes")
        .select("id")
        .eq("id", b.instituteId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("a student cannot UPDATE another institute's row", async () => {
      const { data, error } = await a.client
        .from("institutes")
        .update({ name: "HACKED" })
        .eq("id", b.instituteId)
        .select();
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: check } = await admin
        .from("institutes")
        .select("name")
        .eq("id", b.instituteId)
        .single();
      expect(check?.name).not.toBe("HACKED");
    });

    it("a student cannot DELETE another institute's row (no delete policy exists for any role)", async () => {
      const { data } = await a.client
        .from("institutes")
        .delete()
        .eq("id", b.instituteId)
        .select();
      expect(data).toEqual([]);

      const { data: check } = await admin
        .from("institutes")
        .select("id")
        .eq("id", b.instituteId)
        .maybeSingle();
      expect(check).not.toBeNull();
    });

    it("a student cannot SELECT another institute's profile rows", async () => {
      const { data, error } = await a.client
        .from("profiles")
        .select("id")
        .eq("id", b.userId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("a student cannot forge an audit_logs entry for another institute", async () => {
      const { error } = await a.client.from("audit_logs").insert({
        institute_id: b.instituteId,
        actor_id: a.userId,
        action: "forged.entry",
      });
      expect(error).not.toBeNull();
    });

    it("a student cannot read audit_logs at all, even their own institute's", async () => {
      await admin.from("audit_logs").insert({
        institute_id: a.instituteId,
        actor_id: a.userId,
        action: "test.entry",
      });

      const { data, error } = await a.client
        .from("audit_logs")
        .select("id")
        .eq("institute_id", a.instituteId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("a user cannot escalate their own role", async () => {
      const { error } = await a.client
        .from("profiles")
        .update({ role: "super_admin" })
        .eq("id", a.userId);
      expect(error).not.toBeNull();

      const { data: check } = await admin
        .from("profiles")
        .select("role")
        .eq("id", a.userId)
        .single();
      expect(check?.role).toBe("student");
    });

    it("a user cannot change their own institute_id", async () => {
      const { error } = await a.client
        .from("profiles")
        .update({ institute_id: b.instituteId })
        .eq("id", a.userId);
      expect(error).not.toBeNull();

      const { data: check } = await admin
        .from("profiles")
        .select("institute_id")
        .eq("id", a.userId)
        .single();
      expect(check?.institute_id).toBe(a.instituteId);
    });
  },
);
