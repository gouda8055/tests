import { config as loadEnv } from "dotenv";
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });

// Requires `pnpm dev` running (playwright.config.ts starts it
// automatically) against a real Supabase project with migrations
// 0001-0009 applied. Skips gracefully without SUPABASE_SERVICE_ROLE_KEY —
// see tests/rls/tenant-isolation.test.ts for why, and the same caution
// about never pointing this at production.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN ?? "localtest.me";
const PORT = process.env.PORT ?? "3000";

const CREDENTIALS_AVAILABLE = Boolean(
  SUPABASE_URL &&
  ANON_KEY &&
  SERVICE_ROLE_KEY &&
  SERVICE_ROLE_KEY !== "sandbox-local-dummy-not-a-real-secret",
);

test.describe("signup, login, dashboard", () => {
  test.skip(
    !CREDENTIALS_AVAILABLE,
    "Requires a real SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );

  let admin: SupabaseClient;
  let instituteId: string;
  let baseUrl: string;

  test.beforeAll(async () => {
    if (!CREDENTIALS_AVAILABLE) return;

    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const subdomain = `e2e-${Date.now().toString(36)}`;
    const { data, error } = await admin
      .from("institutes")
      .insert({ name: "E2E Test Institute", subdomain })
      .select("id")
      .single();
    if (error || !data)
      throw new Error(`Could not create test institute: ${error?.message}`);

    instituteId = data.id;
    baseUrl = `http://${subdomain}.${APP_DOMAIN}:${PORT}`;
  });

  test.afterAll(async () => {
    if (!CREDENTIALS_AVAILABLE || !instituteId) return;

    const { data: profiles } = await admin
      .from("profiles")
      .select("id")
      .eq("institute_id", instituteId);
    for (const profile of profiles ?? []) {
      await admin.auth.admin.deleteUser(profile.id);
    }
    await admin.from("audit_logs").delete().eq("institute_id", instituteId);
    await admin.from("institutes").delete().eq("id", instituteId);
  });

  test("sign up, land on the student dashboard, sign out, sign back in", async ({
    page,
  }) => {
    const email = `e2e-${Date.now().toString(36)}@example.com`;
    const password = "correctHorse1Battery";

    await page.goto(`${baseUrl}/sign-up`);
    await page.getByLabel("Full name").fill("E2E Test Student");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account" }).click();

    await page.waitForURL(`${baseUrl}/student`);
    await expect(page.getByText("E2E Test Student")).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(`${baseUrl}/`);

    await page.goto(`${baseUrl}/sign-in`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(`${baseUrl}/student`);
    await expect(page.getByText("E2E Test Student")).toBeVisible();
  });
});
