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
 * Stage 8: a course's certificate requires passing EVERY quiz the
 * instructor marked as counting (passing_score_percent set), not just
 * one — the user explicitly chose this whole-course semantics over the
 * simpler single-quiz alternative. Two counting quizzes here, each
 * requiring 100% (single question, all-or-nothing scoring), so passing
 * one but not the other must leave the student at "not yet earned."
 */
test.describe("Stage 8: course-completion certificates", () => {
  test.skip(
    !CREDENTIALS_AVAILABLE,
    "Requires a real SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  test.describe.configure({ retries: 2 });
  test.setTimeout(120_000);

  let admin: SupabaseClient;
  let instituteId: string;
  let baseUrl: string;
  let courseId: string;
  let quiz1Id: string;
  let quiz2Id: string;
  const runId = Date.now().toString(36);
  const ownerEmail = `e2e-stage8-owner-${runId}@example.com`;
  const studentEmail = `e2e-stage8-student-${runId}@example.com`;
  const password = "correctHorse1Battery";

  async function createCountingQuiz(title: string, ownerId: string) {
    const { data: quiz, error: quizError } = await admin
      .from("quizzes")
      .insert({
        institute_id: instituteId,
        course_id: courseId,
        created_by: ownerId,
        title,
        status: "published",
        duration_seconds: 600,
        grace_seconds: 30,
        max_attempts: 3,
        passing_score_percent: 100,
      })
      .select("id")
      .single();
    if (quizError || !quiz) throw new Error(`fixture quiz "${title}" failed: ${quizError?.message}`);

    const { data: question, error: questionError } = await admin
      .from("quiz_questions")
      .insert({
        institute_id: instituteId,
        quiz_id: quiz.id,
        question_text: "2 + 2?",
        question_type: "single_choice",
        points: 1,
      })
      .select("id")
      .single();
    if (questionError || !question) throw new Error(`fixture question for "${title}" failed: ${questionError?.message}`);

    const { data: opts, error: optsError } = await admin
      .from("quiz_question_options")
      .insert([
        { institute_id: instituteId, question_id: question.id, position: 0, option_text: "4" },
        { institute_id: instituteId, question_id: question.id, position: 1, option_text: "5" },
      ])
      .select("id, position");
    if (optsError || !opts) throw new Error(`fixture options for "${title}" failed: ${optsError?.message}`);
    const correctId = opts.find((o) => o.position === 0)!.id as string;

    const { error: keyError } = await admin.from("quiz_answer_keys").insert({
      institute_id: instituteId,
      question_id: question.id,
      correct_option_ids: [correctId],
    });
    if (keyError) throw new Error(`fixture answer key for "${title}" failed: ${keyError.message}`);

    return quiz.id as string;
  }

  test.beforeAll(async () => {
    if (!CREDENTIALS_AVAILABLE) return;

    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const subdomain = `e2e-stage8-${runId}`;
    const { data: institute, error: instituteError } = await admin
      .from("institutes")
      .insert({ name: "E2E Stage 8 Institute", subdomain })
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
        title: "Stage 8 Course",
        status: "published",
      })
      .select("id")
      .single();
    if (courseError || !course) throw new Error(`fixture course failed: ${courseError?.message}`);
    courseId = course.id;

    quiz1Id = await createCountingQuiz("Stage 8 Quiz 1", ownerUser.user.id);
    quiz2Id = await createCountingQuiz("Stage 8 Quiz 2", ownerUser.user.id);
  });

  test.afterAll(async () => {
    if (!CREDENTIALS_AVAILABLE || !instituteId) return;
    const warn = (label: string, error: { message: string } | null) => {
      if (error) console.warn(`cleanup: ${label} failed: ${error.message}`);
    };
    warn("certificates", (await admin.from("certificates").delete().eq("institute_id", instituteId)).error);
    warn("quiz_attempt_answers", (await admin.from("quiz_attempt_answers").delete().eq("institute_id", instituteId)).error);
    warn("quiz_attempts", (await admin.from("quiz_attempts").delete().eq("institute_id", instituteId)).error);
    warn("quiz_answer_keys", (await admin.from("quiz_answer_keys").delete().eq("institute_id", instituteId)).error);
    warn("quiz_question_options", (await admin.from("quiz_question_options").delete().eq("institute_id", instituteId)).error);
    warn("quiz_questions", (await admin.from("quiz_questions").delete().eq("institute_id", instituteId)).error);
    warn("quizzes", (await admin.from("quizzes").delete().eq("institute_id", instituteId)).error);
    warn("enrollments", (await admin.from("enrollments").delete().eq("institute_id", instituteId)).error);
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

  test("certificate is issued only after passing every counting quiz, and /verify confirms it with no login", async ({
    browser,
  }) => {
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await studentPage.goto(`${baseUrl}/sign-in`);
    await studentPage.getByLabel("Email").fill(studentEmail);
    await studentPage.getByLabel("Password").fill(password);
    await studentPage.getByRole("button", { name: "Sign in" }).click();
    await studentPage.waitForURL(`${baseUrl}/student`);

    await studentPage.goto(`${baseUrl}/student/courses/${courseId}`);
    await studentPage.getByRole("button", { name: "Enroll in this course" }).click();
    await expect(studentPage.getByText("Lessons", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Pass quiz 1 only, correctly.
    await studentPage.goto(`${baseUrl}/student/courses/${courseId}/quizzes/${quiz1Id}`);
    await studentPage.getByRole("button", { name: "Start quiz" }).click();
    await studentPage.waitForURL(/\/attempts\/[0-9a-f-]+$/);
    await studentPage.reload();
    await studentPage.getByLabel("4").check();
    await expect(studentPage.getByText("Saved")).toBeVisible({ timeout: 5000 });
    await studentPage.getByRole("button", { name: "Submit attempt" }).click();
    await studentPage.waitForURL(/\/result$/);
    await studentPage.reload();
    await expect(studentPage.getByText(/1\s*\/\s*1/)).toBeVisible();

    // Only one of two counting quizzes passed — no certificate yet.
    await studentPage.goto(`${baseUrl}/student/courses/${courseId}/certificate`);
    await expect(studentPage.getByText("Not yet earned", { exact: true })).toBeVisible();
    await expect(studentPage.getByText("Stage 8 Quiz 1", { exact: true })).toBeVisible();
    await expect(studentPage.getByText("Passed", { exact: true })).toBeVisible();
    await expect(studentPage.getByText("Needs 100%", { exact: true })).toBeVisible();

    // Now pass quiz 2 as well.
    await studentPage.goto(`${baseUrl}/student/courses/${courseId}/quizzes/${quiz2Id}`);
    await studentPage.getByRole("button", { name: "Start quiz" }).click();
    await studentPage.waitForURL(/\/attempts\/[0-9a-f-]+$/);
    await studentPage.reload();
    await studentPage.getByLabel("4").check();
    await expect(studentPage.getByText("Saved")).toBeVisible({ timeout: 5000 });
    await studentPage.getByRole("button", { name: "Submit attempt" }).click();
    await studentPage.waitForURL(/\/result$/);
    await studentPage.reload();
    await expect(studentPage.getByText(/1\s*\/\s*1/)).toBeVisible();

    // Both counting quizzes passed now — certificate should be issued.
    await studentPage.goto(`${baseUrl}/student/courses/${courseId}/certificate`);
    await expect(studentPage.getByText("Certificate earned", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    const downloadLink = studentPage.getByRole("link", { name: "Download certificate" });
    await expect(downloadLink).toBeVisible();
    await expect(downloadLink).toHaveAttribute("href", /\/api\/certificates\/[0-9a-f-]+\/pdf$/);

    const verifyLink = studentPage.getByRole("link", { name: /\/verify\// });
    const verifyHref = await verifyLink.getAttribute("href");
    expect(verifyHref).toMatch(/^\/verify\/[0-9a-f-]+$/);

    await studentContext.close();

    // Hit /verify directly with a brand-new, unauthenticated context.
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();
    await anonPage.goto(`${baseUrl}${verifyHref}`);
    await expect(anonPage.getByText("Valid certificate", { exact: true })).toBeVisible();
    await expect(anonPage.getByText("Stage 8 Course")).toBeVisible();
    await anonContext.close();
  });
});
