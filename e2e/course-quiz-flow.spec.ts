import { config as loadEnv } from "dotenv";
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });

// Same skip-gracefully-without-credentials convention as
// signup-login-dashboard.spec.ts — see that file for why.
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

test.describe("course authoring + quiz attempt, end to end", () => {
  test.skip(
    !CREDENTIALS_AVAILABLE,
    "Requires a real SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  // Next.js 16.4.0's dev server (Turbopack + Cache Components) has an
  // intermittent client-router bug: after a Server Action's redirect() (or
  // even a plain refresh()), the URL updates but the DOM occasionally never
  // re-renders — confirmed via manual investigation to be a dev-only race
  // (a hard page.reload() always recovers the correct, already-persisted
  // server state; `pnpm build` is unaffected). It isn't reliably reproducible
  // step-by-step — it can hit any Server-Action transition in this test,
  // not a specific one — so this file retries the whole flow rather than
  // special-casing one step.
  test.describe.configure({ retries: 2 });

  let admin: SupabaseClient;
  let instituteId: string;
  let baseUrl: string;
  const runId = Date.now().toString(36);
  const ownerEmail = `e2e-owner-${runId}@example.com`;
  const studentEmail = `e2e-student-${runId}@example.com`;
  const password = "correctHorse1Battery";

  test.beforeAll(async () => {
    if (!CREDENTIALS_AVAILABLE) return;

    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const subdomain = `e2e-quiz-${runId}`;
    const { data: institute, error } = await admin
      .from("institutes")
      .insert({ name: "E2E Quiz Flow Institute", subdomain })
      .select("id")
      .single();
    if (error || !institute) throw new Error(`Could not create test institute: ${error?.message}`);
    instituteId = institute.id;
    baseUrl = `http://${subdomain}.${APP_DOMAIN}:${PORT}`;

    // Owner account is created directly (bypassing the /platform UI, which
    // is Stage 1 and already covered by its own tests) so this test can
    // focus entirely on Stage 2's course/quiz authoring and attempt flow.
    const { data: ownerUser, error: ownerError } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password,
      email_confirm: true,
    });
    if (ownerError || !ownerUser.user) throw new Error(`Owner user failed: ${ownerError?.message}`);
    const { error: ownerProfileError } = await admin.from("profiles").insert({
      id: ownerUser.user.id,
      institute_id: instituteId,
      role: "institute_owner",
      full_name: "E2E Owner",
    });
    if (ownerProfileError) throw new Error(`Owner profile failed: ${ownerProfileError.message}`);
  });

  test.afterAll(async () => {
    if (!CREDENTIALS_AVAILABLE || !instituteId) return;

    const { data: profiles } = await admin
      .from("profiles")
      .select("id")
      .eq("institute_id", instituteId);

    const warn = (label: string, error: { message: string } | null) => {
      if (error) console.warn(`cleanup: ${label} failed: ${error.message}`);
    };

    warn(
      "quiz_attempt_answers",
      (await admin.from("quiz_attempt_answers").delete().eq("institute_id", instituteId)).error,
    );
    warn(
      "quiz_attempts",
      (await admin.from("quiz_attempts").delete().eq("institute_id", instituteId)).error,
    );
    warn(
      "quiz_answer_keys",
      (await admin.from("quiz_answer_keys").delete().eq("institute_id", instituteId)).error,
    );
    warn(
      "quiz_question_options",
      (await admin.from("quiz_question_options").delete().eq("institute_id", instituteId)).error,
    );
    warn(
      "quiz_questions",
      (await admin.from("quiz_questions").delete().eq("institute_id", instituteId)).error,
    );
    warn("quizzes", (await admin.from("quizzes").delete().eq("institute_id", instituteId)).error);
    warn(
      "enrollments",
      (await admin.from("enrollments").delete().eq("institute_id", instituteId)).error,
    );
    warn("lessons", (await admin.from("lessons").delete().eq("institute_id", instituteId)).error);
    warn("courses", (await admin.from("courses").delete().eq("institute_id", instituteId)).error);
    warn(
      "audit_logs",
      (await admin.from("audit_logs").delete().eq("institute_id", instituteId)).error,
    );

    // Delete profiles directly ahead of institutes, and auth users last —
    // see the teardown race fixed in tenant-isolation.test.ts.
    for (const profile of profiles ?? []) {
      warn(
        `profile ${profile.id}`,
        (await admin.from("profiles").delete().eq("id", profile.id)).error,
      );
    }
    warn("institute", (await admin.from("institutes").delete().eq("id", instituteId)).error);
    for (const profile of profiles ?? []) {
      warn(
        `auth user ${profile.id}`,
        (await admin.auth.admin.deleteUser(profile.id)).error,
      );
    }
  });

  test("owner authors a course+lesson+quiz with a correct answer, student enrolls and scores full marks", async ({
    page,
  }) => {
    // --- Sign in as the owner ---
    await page.goto(`${baseUrl}/sign-in`);
    await expect(page.getByLabel("Email")).toBeVisible();
    await page.getByLabel("Email").fill(ownerEmail);
    await page.getByLabel("Password").fill(password);
    await expect(page.getByLabel("Password")).toHaveValue(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${baseUrl}/admin`);
    await page.reload();
    await page.waitForLoadState("networkidle");

    // --- Create and publish a course ---
    await page.goto(`${baseUrl}/admin/courses`);
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Title").fill("Intro to Algebra");
    await page.getByLabel("Description (optional)").fill("Algebra fundamentals.");
    await page.getByRole("button", { name: "Create course" }).click();
    await page.waitForURL(/\/admin\/courses\/[0-9a-f-]+$/);
    const courseUrl = page.url();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Intro to Algebra" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("published", { exact: true })).toBeVisible();

    // --- Add and publish a lesson ---
    await page.getByRole("link", { name: "New lesson" }).click();
    await page.getByLabel("Title").fill("What is a variable?");
    await page
      .getByLabel("Content (Markdown)")
      .fill("A **variable** stands in for a number, e.g. `x + 2 = 5`.");
    await page.getByRole("button", { name: "Create lesson" }).click();
    await page.waitForURL(/\/lessons\/[0-9a-f-]+$/);
    // Reload needed after a Server-Action redirect into a brand-new dynamic
    // route in Next 16.4.0's dev server — see the course-creation step above.
    await page.reload();
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("published", { exact: true })).toBeVisible();

    // --- Create a quiz ---
    await page.goto(courseUrl);
    await page.getByRole("tab", { name: /Quizzes/ }).click();
    await page.getByRole("link", { name: "New quiz" }).click();
    await page.getByLabel("Title").fill("Chapter 1 Quiz");
    await page.getByLabel("Duration (minutes)").fill("10");
    await page.getByLabel("Grace period (seconds)").fill("30");
    await page.getByLabel("Attempts allowed").fill("2");
    await page.getByRole("button", { name: "Create quiz" }).click();
    await page.waitForURL(/\/quizzes\/[0-9a-f-]+$/);
    await page.reload();
    const quizUrl = page.url();

    // --- Add a single-choice question with exactly one correct option ---
    await page.getByRole("link", { name: "Add question" }).click();
    await page.getByLabel("Question (Markdown)").fill("What is x in x + 2 = 5?");
    await page.getByPlaceholder("Option 1").fill("3");
    await page.getByPlaceholder("Option 2").fill("5");
    await page.getByPlaceholder("Option 3").fill("7");
    // Real browser + real JS: the Radix checkbox actually toggles here,
    // unlike in a JS-disabled context.
    await page.getByLabel("Option 1 is correct").check();
    await page.getByRole("button", { name: "Add question" }).click();
    await page.waitForURL(quizUrl);
    await page.reload();
    await expect(page.getByText("What is x in x + 2 = 5?")).toBeVisible();

    // --- Publish the quiz ---
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("published", { exact: true })).toBeVisible();

    // --- Sign out, sign up a fresh student on this tenant ---
    await page.goto(`${baseUrl}/admin`);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForTimeout(1000);
    await page.goto(`${baseUrl}/sign-up`);
    await page.reload();
    await page.getByLabel("Full name").fill("E2E Student");
    await page.getByLabel("Email").fill(studentEmail);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(`${baseUrl}/student`);
    await page.reload();

    // --- Enroll in the course (Enroll lives on the course detail page, not the list) ---
    await page.goto(`${baseUrl}/student/courses`);
    await page.getByRole("link", { name: "Intro to Algebra" }).click();
    await page.getByRole("button", { name: "Enroll in this course" }).click();
    await page.waitForTimeout(1000);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Lessons" })).toBeVisible({
      timeout: 15_000,
    });

    // --- Read the lesson (server-rendered markdown) ---
    await page.getByRole("link", { name: "What is a variable?" }).click();
    await expect(page.getByText("stands in for a number")).toBeVisible();

    // --- Take the quiz: start, answer correctly, submit ---
    await page.goBack();
    await page.getByRole("link", { name: "Chapter 1 Quiz" }).click();
    await page.getByRole("button", { name: "Start quiz" }).click();
    await page.waitForURL(/\/attempts\/[0-9a-f-]+$/);
    await page.reload();

    await page.getByLabel("3").check();
    // Autosave is debounced client-side; wait for the "Saved" indicator
    // rather than a fixed sleep.
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 5000 });

    await page.getByRole("button", { name: "Submit attempt" }).click();
    await page.waitForURL(/\/result$/);
    await page.reload();

    // --- Verify the score, and that no raw answer-key data ever reached the client ---
    await expect(page.getByText(/1\s*\/\s*1/)).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain("correct_option_ids");
  });
});
