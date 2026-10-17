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

test.describe("Stage 5: question pools, short answer, analytics, audit log, settings, search", () => {
  test.skip(
    !CREDENTIALS_AVAILABLE,
    "Requires a real SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  test.describe.configure({ retries: 2 }); // same dev-server flake precedent as course-quiz-flow.spec.ts
  test.setTimeout(180_000); // this single flow does far more sequential navigation than any other spec

  let admin: SupabaseClient;
  let instituteId: string;
  let baseUrl: string;
  let courseId: string;
  let poolQuizId: string;
  let saQuizId: string;
  let saChoiceQuestionId: string;
  const runId = Date.now().toString(36);
  const ownerEmail = `e2e-stage5-owner-${runId}@example.com`;
  const studentEmail = `e2e-stage5-student-${runId}@example.com`;
  const password = "correctHorse1Battery";
  const newPassword = "correctHorse1BatteryStaple2";

  test.beforeAll(async () => {
    if (!CREDENTIALS_AVAILABLE) return;

    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const subdomain = `e2e-stage5-${runId}`;
    const { data: institute, error: instituteError } = await admin
      .from("institutes")
      .insert({ name: "E2E Stage 5 Institute", subdomain })
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
        title: "Stage 5 Course",
        status: "published",
      })
      .select("id")
      .single();
    if (courseError || !course) throw new Error(`fixture course failed: ${courseError?.message}`);
    courseId = course.id;

    const { error: enrollmentError } = await admin
      .from("enrollments")
      .insert({ institute_id: instituteId, course_id: courseId, student_id: studentUser.user.id });
    if (enrollmentError) throw new Error(`fixture enrollment failed: ${enrollmentError.message}`);

    // --- Pool quiz: 3 single_choice questions, pool_size will be set to 2 via the UI ---
    const { data: poolQuiz, error: poolQuizError } = await admin
      .from("quizzes")
      .insert({
        institute_id: instituteId,
        course_id: courseId,
        created_by: ownerUser.user.id,
        title: "Pool Quiz",
        status: "draft",
        duration_seconds: 600,
        grace_seconds: 30,
        max_attempts: 3,
      })
      .select("id")
      .single();
    if (poolQuizError || !poolQuiz) throw new Error(`pool quiz failed: ${poolQuizError?.message}`);
    poolQuizId = poolQuiz.id;

    for (let i = 0; i < 3; i += 1) {
      const { data: q, error: qError } = await admin
        .from("quiz_questions")
        .insert({
          institute_id: instituteId,
          quiz_id: poolQuizId,
          position: i,
          question_text: `Pool question ${i + 1}?`,
          question_type: "single_choice",
          points: 1,
        })
        .select("id")
        .single();
      if (qError || !q) throw new Error(`pool question failed: ${qError?.message}`);
      const { data: opts, error: optsError } = await admin
        .from("quiz_question_options")
        .insert([
          { institute_id: instituteId, question_id: q.id, position: 0, option_text: "A" },
          { institute_id: instituteId, question_id: q.id, position: 1, option_text: "B" },
        ])
        .select("id, position");
      if (optsError || !opts) throw new Error(`pool options failed: ${optsError?.message}`);
      const correctId = opts.find((o) => o.position === 0)!.id;
      const { error: keyError } = await admin.from("quiz_answer_keys").insert({
        institute_id: instituteId,
        question_id: q.id,
        correct_option_ids: [correctId],
      });
      if (keyError) throw new Error(`pool key failed: ${keyError.message}`);
    }

    // --- Short-answer quiz: one single_choice question seeded, one short_answer added via UI ---
    const { data: saQuiz, error: saQuizError } = await admin
      .from("quizzes")
      .insert({
        institute_id: instituteId,
        course_id: courseId,
        created_by: ownerUser.user.id,
        title: "Short Answer Quiz",
        status: "draft",
        duration_seconds: 600,
        grace_seconds: 30,
        max_attempts: 3,
      })
      .select("id")
      .single();
    if (saQuizError || !saQuiz) throw new Error(`sa quiz failed: ${saQuizError?.message}`);
    saQuizId = saQuiz.id;

    const { data: saChoiceQuestion, error: saChoiceError } = await admin
      .from("quiz_questions")
      .insert({
        institute_id: instituteId,
        quiz_id: saQuizId,
        position: 0,
        question_text: "2 + 2?",
        question_type: "single_choice",
        points: 1,
      })
      .select("id")
      .single();
    if (saChoiceError || !saChoiceQuestion) throw new Error(`sa choice question failed: ${saChoiceError?.message}`);
    saChoiceQuestionId = saChoiceQuestion.id;
    const { data: saOpts, error: saOptsError } = await admin
      .from("quiz_question_options")
      .insert([
        { institute_id: instituteId, question_id: saChoiceQuestionId, position: 0, option_text: "4" },
        { institute_id: instituteId, question_id: saChoiceQuestionId, position: 1, option_text: "5" },
      ])
      .select("id, position");
    if (saOptsError || !saOpts) throw new Error(`sa options failed: ${saOptsError?.message}`);
    const saCorrectId = saOpts.find((o) => o.position === 0)!.id;
    const { error: saKeyError } = await admin.from("quiz_answer_keys").insert({
      institute_id: instituteId,
      question_id: saChoiceQuestionId,
      correct_option_ids: [saCorrectId],
    });
    if (saKeyError) throw new Error(`sa key failed: ${saKeyError.message}`);
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

  test("question pools, short answer, analytics, audit log, settings, and search", async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();

    await ownerPage.goto(`${baseUrl}/sign-in`);
    await ownerPage.getByLabel("Email").fill(ownerEmail);
    await ownerPage.getByLabel("Password").fill(password);
    await ownerPage.getByRole("button", { name: "Sign in" }).click();
    await ownerPage.waitForURL(`${baseUrl}/admin`);

    // --- Set pool_size = 2 on the Pool Quiz, then publish it ---
    const poolQuizUrl = `${baseUrl}/admin/courses/${courseId}/quizzes/${poolQuizId}`;
    await ownerPage.goto(poolQuizUrl);
    await ownerPage.getByRole("tab", { name: "Settings" }).click();
    await ownerPage.getByLabel("Questions per attempt (optional)").fill("2");
    await ownerPage.getByRole("button", { name: "Save quiz" }).click();
    await expect(ownerPage.getByText("Quiz saved.")).toBeVisible({ timeout: 10_000 });
    await ownerPage.getByRole("button", { name: "Publish" }).click();
    await expect(ownerPage.getByText("published", { exact: true })).toBeVisible();

    // --- Add a short_answer question to the Short Answer Quiz via the UI ---
    const saQuizUrl = `${baseUrl}/admin/courses/${courseId}/quizzes/${saQuizId}`;
    await ownerPage.goto(`${saQuizUrl}/questions/new`);
    await ownerPage.getByLabel("Question (Markdown)").fill("What is the capital of France?");
    // Radix Select isn't a native <select>; open it and pick the option.
    await ownerPage.getByLabel("Type").click();
    await ownerPage.getByRole("option", { name: "Short answer (exact text match)" }).click();
    await ownerPage.getByLabel("Acceptable answers (one per line)").fill("Paris\nparis");
    await ownerPage.getByRole("button", { name: "Add question" }).click();
    await expect(ownerPage).toHaveURL(saQuizUrl);
    await ownerPage.reload();
    await expect(ownerPage.getByText("What is the capital of France?")).toBeVisible();
    await ownerPage.getByRole("button", { name: "Publish" }).click();
    await expect(ownerPage.getByText("published", { exact: true })).toBeVisible();

    // --- Course search (admin side) ---
    await ownerPage.goto(`${baseUrl}/admin/courses`);
    await ownerPage.getByLabel("Search courses").fill("Stage 5 Course");
    await expect(ownerPage.getByRole("link", { name: "Stage 5 Course" })).toBeVisible();
    await ownerPage.getByLabel("Search courses").fill("no such course exists");
    await expect(ownerPage.getByText("No courses match your search.")).toBeVisible();

    await ownerContext.close();

    // --- Student: take the Pool Quiz, confirm only 2 of 3 questions shown ---
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await studentPage.goto(`${baseUrl}/sign-in`);
    await studentPage.getByLabel("Email").fill(studentEmail);
    await studentPage.getByLabel("Password").fill(password);
    await studentPage.getByRole("button", { name: "Sign in" }).click();
    await studentPage.waitForURL(`${baseUrl}/student`);

    // --- Course search (student side) ---
    await studentPage.goto(`${baseUrl}/student/courses`);
    await studentPage.getByLabel("Search courses").fill("Stage 5");
    await expect(studentPage.getByRole("link", { name: "Stage 5 Course" })).toBeVisible();

    // Already enrolled via the admin fixture above — go straight to the quiz.
    await studentPage.goto(`${baseUrl}/student/courses/${courseId}/quizzes/${poolQuizId}`);
    await studentPage.getByRole("button", { name: "Start quiz" }).click();
    await studentPage.waitForURL(/\/attempts\/[0-9a-f-]+$/);
    await studentPage.reload();
    await expect(studentPage.getByText(/^Question 1$/)).toBeVisible();
    await expect(studentPage.getByText(/^Question 2$/)).toBeVisible();
    await expect(studentPage.getByText(/^Question 3$/)).toHaveCount(0);

    // --- Short Answer Quiz: answer both questions, submit, check grading ---
    await studentPage.goto(`${baseUrl}/student/courses/${courseId}/quizzes/${saQuizId}`);
    await studentPage.getByRole("button", { name: "Start quiz" }).click();
    await studentPage.waitForURL(/\/attempts\/[0-9a-f-]+$/);
    await studentPage.reload();
    await studentPage.getByLabel("4").check();
    await studentPage.getByLabel("Your answer").fill("  PARIS  ");
    await expect(studentPage.getByText("Saved").first()).toBeVisible({ timeout: 5000 });
    await studentPage.getByRole("button", { name: "Submit attempt" }).click();
    await studentPage.waitForURL(/\/result$/);
    await studentPage.reload();
    await expect(studentPage.getByText(/2\s*\/\s*2/)).toBeVisible();

    await studentContext.close();

    // --- Owner: analytics + audit log + settings ---
    const ownerContext2 = await browser.newContext();
    const ownerPage2 = await ownerContext2.newPage();
    await ownerPage2.goto(`${baseUrl}/sign-in`);
    await ownerPage2.getByLabel("Email").fill(ownerEmail);
    await ownerPage2.getByLabel("Password").fill(password);
    await ownerPage2.getByRole("button", { name: "Sign in" }).click();
    await ownerPage2.waitForURL(`${baseUrl}/admin`);

    await ownerPage2.goto(`${saQuizUrl}/analytics`);
    await expect(ownerPage2.getByText("Average score:")).toBeVisible();
    await expect(ownerPage2.getByText("100.0%")).toBeVisible({ timeout: 10_000 });

    await ownerPage2.goto(`${baseUrl}/admin/audit-log`);
    await expect(ownerPage2.getByText("quiz.attempt.submitted")).toBeVisible({ timeout: 10_000 });

    // --- Settings: update name, change password, verify the new password works ---
    await ownerPage2.goto(`${baseUrl}/admin/settings`);
    await ownerPage2.getByLabel("Full name").fill("E2E Owner Renamed");
    await ownerPage2.getByRole("button", { name: "Save name" }).click();
    await expect(ownerPage2.getByText("Name updated.")).toBeVisible({ timeout: 10_000 });

    await ownerPage2.getByLabel("New password", { exact: true }).fill(newPassword);
    await ownerPage2.getByLabel("Confirm new password").fill(newPassword);
    await ownerPage2.getByRole("button", { name: "Change password" }).click();
    await expect(ownerPage2.getByText("Password updated.")).toBeVisible({ timeout: 10_000 });

    await ownerContext2.close();

    const verifyContext = await browser.newContext();
    const verifyPage = await verifyContext.newPage();
    await verifyPage.goto(`${baseUrl}/sign-in`);
    await verifyPage.getByLabel("Email").fill(ownerEmail);
    await verifyPage.getByLabel("Password").fill(newPassword);
    await verifyPage.getByRole("button", { name: "Sign in" }).click();
    await verifyPage.waitForURL(`${baseUrl}/admin`);
    await expect(verifyPage.getByText("E2E Owner Renamed")).toBeVisible();
    await verifyContext.close();
  });
});
