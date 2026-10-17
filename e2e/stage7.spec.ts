import { config as loadEnv } from "dotenv";
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });

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

/**
 * No real Resend account exists (.env.local has no RESEND_API_KEY) — same
 * "dormant until configured" treatment Stage 2/6 gave Bunny Stream/
 * Razorpay, except the failure mode that actually matters here is
 * different: a missing email provider must never fail the action it's
 * attached to. This verifies exactly that for the three trigger points
 * reachable without a real Razorpay account (the fourth,
 * notifyPaymentCaptured in the webhook, is covered by the same dormant-
 * webhook precedent Stage 6 already established — see HANDOFF.md):
 * free enrollment, quiz publish, and quiz submission/grading all still
 * succeed exactly as before Stage 7.
 */
test.describe("Stage 7: notifications never block the action they're attached to", () => {
  test.skip(
    !CREDENTIALS_AVAILABLE,
    "Requires a real SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  test.describe.configure({ retries: 2 });
  test.setTimeout(90_000);

  let admin: SupabaseClient;
  let instituteId: string;
  let baseUrl: string;
  let courseId: string;
  let quizId: string;
  const runId = Date.now().toString(36);
  const ownerEmail = `e2e-stage7-owner-${runId}@example.com`;
  const studentEmail = `e2e-stage7-student-${runId}@example.com`;
  const password = "correctHorse1Battery";

  test.beforeAll(async () => {
    if (!CREDENTIALS_AVAILABLE) return;

    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const subdomain = `e2e-stage7-${runId}`;
    const { data: institute, error: instituteError } = await admin
      .from("institutes")
      .insert({ name: "E2E Stage 7 Institute", subdomain })
      .select("id")
      .single();
    if (instituteError || !institute) throw new Error(`fixture institute failed: ${instituteError?.message}`);
    instituteId = institute.id;
    baseUrl = `http://${subdomain}.${APP_DOMAIN}:${PORT}`;

    const { data: ownerUser, error: ownerError } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password,
      email_confirm: true,
    });
    if (ownerError || !ownerUser.user) throw new Error(`owner user failed: ${ownerError?.message}`);

    const { data: studentUser, error: studentError } = await admin.auth.admin.createUser({
      email: studentEmail,
      password,
      email_confirm: true,
    });
    if (studentError || !studentUser.user) throw new Error(`student user failed: ${studentError?.message}`);

    const { error: profilesError } = await admin.from("profiles").insert([
      { id: ownerUser.user.id, institute_id: instituteId, role: "institute_owner", full_name: "E2E Owner" },
      { id: studentUser.user.id, institute_id: instituteId, role: "student", full_name: "E2E Student" },
    ]);
    if (profilesError) throw new Error(`fixture profiles failed: ${profilesError.message}`);

    const { data: course, error: courseError } = await admin
      .from("courses")
      .insert({
        institute_id: instituteId,
        created_by: ownerUser.user.id,
        title: "Stage 7 Course",
        status: "published",
      })
      .select("id")
      .single();
    if (courseError || !course) throw new Error(`fixture course failed: ${courseError?.message}`);
    courseId = course.id;

    const { data: quiz, error: quizError } = await admin
      .from("quizzes")
      .insert({
        institute_id: instituteId,
        course_id: courseId,
        created_by: ownerUser.user.id,
        title: "Stage 7 Quiz",
        status: "draft",
        duration_seconds: 600,
        grace_seconds: 30,
        max_attempts: 3,
      })
      .select("id")
      .single();
    if (quizError || !quiz) throw new Error(`fixture quiz failed: ${quizError?.message}`);
    quizId = quiz.id;

    const { data: question, error: questionError } = await admin
      .from("quiz_questions")
      .insert({
        institute_id: instituteId,
        quiz_id: quizId,
        question_text: "2 + 2?",
        question_type: "single_choice",
        points: 1,
      })
      .select("id")
      .single();
    if (questionError || !question) throw new Error(`fixture question failed: ${questionError?.message}`);
    const { data: opts, error: optsError } = await admin
      .from("quiz_question_options")
      .insert([
        { institute_id: instituteId, question_id: question.id, position: 0, option_text: "4" },
        { institute_id: instituteId, question_id: question.id, position: 1, option_text: "5" },
      ])
      .select("id, position");
    if (optsError || !opts) throw new Error(`fixture options failed: ${optsError?.message}`);
    const correctId = opts.find((o) => o.position === 0)!.id;
    const { error: keyError } = await admin.from("quiz_answer_keys").insert({
      institute_id: instituteId,
      question_id: question.id,
      correct_option_ids: [correctId],
    });
    if (keyError) throw new Error(`fixture answer key failed: ${keyError.message}`);
  });

  test.afterAll(async () => {
    if (!CREDENTIALS_AVAILABLE || !instituteId) return;
    const warn = (label: string, error: { message: string } | null) => {
      if (error) console.warn(`cleanup: ${label} failed: ${error.message}`);
    };
    warn("quiz_attempt_answers", (await admin.from("quiz_attempt_answers").delete().eq("institute_id", instituteId)).error);
    warn("quiz_attempts", (await admin.from("quiz_attempts").delete().eq("institute_id", instituteId)).error);
    warn("quiz_answer_keys", (await admin.from("quiz_answer_keys").delete().eq("institute_id", instituteId)).error);
    warn("quiz_question_options", (await admin.from("quiz_question_options").delete().eq("institute_id", instituteId)).error);
    warn("quiz_questions", (await admin.from("quiz_questions").delete().eq("institute_id", instituteId)).error);
    warn("quizzes", (await admin.from("quizzes").delete().eq("institute_id", instituteId)).error);
    warn("enrollments", (await admin.from("enrollments").delete().eq("institute_id", instituteId)).error);
    warn("certificates", (await admin.from("certificates").delete().eq("institute_id", instituteId)).error);
    warn("courses", (await admin.from("courses").delete().eq("institute_id", instituteId)).error);
    warn("audit_logs", (await admin.from("audit_logs").delete().eq("institute_id", instituteId)).error);

    const { data: profiles } = await admin.from("profiles").select("id").eq("institute_id", instituteId);
    for (const profile of profiles ?? []) {
      warn(`profile ${profile.id}`, (await admin.from("profiles").delete().eq("id", profile.id)).error);
    }
    warn("institute", (await admin.from("institutes").delete().eq("id", instituteId)).error);
    for (const profile of profiles ?? []) {
      warn(`auth user ${profile.id}`, (await admin.auth.admin.deleteUser(profile.id)).error);
    }
  });

  test("enroll, publish, and submit/grade all still succeed with no email provider configured", async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(`${baseUrl}/sign-in`);
    await ownerPage.getByLabel("Email").fill(ownerEmail);
    await ownerPage.getByLabel("Password").fill(password);
    await ownerPage.getByRole("button", { name: "Sign in" }).click();
    await ownerPage.waitForURL(`${baseUrl}/admin`);

    // --- setQuizStatus's notifyQuizPublished trigger ---
    await ownerPage.goto(`${baseUrl}/admin/courses/${courseId}/quizzes/${quizId}`);
    await ownerPage.getByRole("button", { name: "Publish" }).click();
    await expect(ownerPage.getByText("published", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    await ownerContext.close();

    // --- enrollInCourse's notifyEnrollmentConfirmed trigger ---
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await studentPage.goto(`${baseUrl}/sign-in`);
    await studentPage.getByLabel("Email").fill(studentEmail);
    await studentPage.getByLabel("Password").fill(password);
    await studentPage.getByRole("button", { name: "Sign in" }).click();
    await studentPage.waitForURL(`${baseUrl}/student`);

    await studentPage.goto(`${baseUrl}/student/courses/${courseId}`);
    await studentPage.getByRole("button", { name: "Enroll in this course" }).click();
    // "Lessons" is a CardTitle (a styled <div>, not a semantic heading).
    await expect(studentPage.getByText("Lessons", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // --- finalizeIfExpired's notifyAttemptGraded trigger ---
    await studentPage.goto(`${baseUrl}/student/courses/${courseId}/quizzes/${quizId}`);
    await studentPage.getByRole("button", { name: "Start quiz" }).click();
    await studentPage.waitForURL(/\/attempts\/[0-9a-f-]+$/);
    await studentPage.reload();
    await studentPage.getByLabel("4").check();
    await expect(studentPage.getByText("Saved")).toBeVisible({ timeout: 5000 });
    await studentPage.getByRole("button", { name: "Submit attempt" }).click();
    await studentPage.waitForURL(/\/result$/);
    await studentPage.reload();
    await expect(studentPage.getByText(/1\s*\/\s*1/)).toBeVisible();

    await studentContext.close();
  });
});
