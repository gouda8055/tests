import { config as loadEnv } from "dotenv";
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });

// Same skip-gracefully-without-credentials convention as the other e2e specs.
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

const CSV = `question_text,points,option_1,option_2,option_3,correct_options
"What is 2 + 2?",1,3,4,5,2
"Which are vowels?",1,a,e,z,1;2`;

test.describe("Stage 4: bulk question import, gradebook export, unenroll", () => {
  test.skip(
    !CREDENTIALS_AVAILABLE,
    "Requires a real SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  test.describe.configure({ retries: 2 }); // same dev-server flake precedent as course-quiz-flow.spec.ts

  let admin: SupabaseClient;
  let instituteId: string;
  let baseUrl: string;
  let courseId: string;
  let quizId: string;
  const runId = Date.now().toString(36);
  const ownerEmail = `e2e-stage4-owner-${runId}@example.com`;
  const removalStudentEmail = `e2e-stage4-removal-${runId}@example.com`;
  const unenrollStudentEmail = `e2e-stage4-unenroll-${runId}@example.com`;
  const password = "correctHorse1Battery";
  const removalStudentName = "ExportTestStudent";

  test.beforeAll(async () => {
    if (!CREDENTIALS_AVAILABLE) return;

    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const subdomain = `e2e-stage4-${runId}`;
    const { data: institute, error: instituteError } = await admin
      .from("institutes")
      .insert({ name: "E2E Stage 4 Institute", subdomain })
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

    const { data: removalUser, error: removalError } = await admin.auth.admin.createUser({
      email: removalStudentEmail,
      password,
      email_confirm: true,
    });
    if (removalError || !removalUser.user) throw new Error(`removal student failed: ${removalError?.message}`);

    const { data: unenrollUser, error: unenrollError } = await admin.auth.admin.createUser({
      email: unenrollStudentEmail,
      password,
      email_confirm: true,
    });
    if (unenrollError || !unenrollUser.user) throw new Error(`unenroll student failed: ${unenrollError?.message}`);

    const { error: profilesError } = await admin.from("profiles").insert([
      {
        id: ownerUser.user.id,
        institute_id: instituteId,
        role: "institute_owner",
        full_name: "E2E Owner",
      },
      {
        id: removalUser.user.id,
        institute_id: instituteId,
        role: "student",
        full_name: removalStudentName,
      },
      {
        id: unenrollUser.user.id,
        institute_id: instituteId,
        role: "student",
        full_name: "E2E Unenroll Student",
      },
    ]);
    if (profilesError) throw new Error(`fixture profiles failed: ${profilesError.message}`);

    const { data: course, error: courseError } = await admin
      .from("courses")
      .insert({
        institute_id: instituteId,
        created_by: ownerUser.user.id,
        title: "Stage 4 Course",
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
        title: "Stage 4 Quiz",
        status: "draft",
        duration_seconds: 600,
        grace_seconds: 30,
        max_attempts: 5,
      })
      .select("id")
      .single();
    if (quizError || !quiz) throw new Error(`fixture quiz failed: ${quizError?.message}`);
    quizId = quiz.id;

    const { error: enrollmentsError } = await admin.from("enrollments").insert([
      { institute_id: instituteId, course_id: courseId, student_id: removalUser.user.id },
      { institute_id: instituteId, course_id: courseId, student_id: unenrollUser.user.id },
    ]);
    if (enrollmentsError) throw new Error(`fixture enrollments failed: ${enrollmentsError.message}`);

    // Seeded directly (not via a real timed attempt) — this spec verifies
    // the export endpoint's output, not the attempt-taking flow itself
    // (already covered end to end by course-quiz-flow.spec.ts).
    const { error: attemptError } = await admin.from("quiz_attempts").insert({
      institute_id: instituteId,
      quiz_id: quizId,
      student_id: removalUser.user.id,
      status: "submitted",
      started_at: new Date(Date.now() - 60_000).toISOString(),
      submitted_at: new Date().toISOString(),
      duration_seconds: 600,
      grace_seconds: 30,
      question_order: [],
      option_order: {},
      seed: 1,
      score: 2,
      max_score: 3,
    });
    if (attemptError) throw new Error(`fixture attempt failed: ${attemptError.message}`);
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

  test("owner bulk-imports questions, publishes, exports the gradebook, and removes a student; the other student self-unenrolls", async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();

    // --- Sign in as owner ---
    await ownerPage.goto(`${baseUrl}/sign-in`);
    await ownerPage.getByLabel("Email").fill(ownerEmail);
    await ownerPage.getByLabel("Password").fill(password);
    await ownerPage.getByRole("button", { name: "Sign in" }).click();
    await ownerPage.waitForURL(`${baseUrl}/admin`);

    // --- Bulk import 2 questions via the textarea ---
    const quizUrl = `${baseUrl}/admin/courses/${courseId}/quizzes/${quizId}`;
    await ownerPage.goto(`${quizUrl}/questions/import`);
    await ownerPage.getByLabel("CSV").fill(CSV);
    await ownerPage.getByRole("button", { name: "Import questions" }).click();
    await expect(ownerPage.getByText("Imported 2 questions.")).toBeVisible({ timeout: 15_000 });

    // --- Publish the quiz (questions exist now, so this is allowed) ---
    await ownerPage.goto(quizUrl);
    await ownerPage.reload();
    await expect(ownerPage.getByText("Questions (2)")).toBeVisible();
    await ownerPage.getByRole("button", { name: "Publish" }).click();
    await expect(ownerPage.getByText("published", { exact: true })).toBeVisible();

    // --- Export the gradebook CSV and check its content directly ---
    const exportResponse = await ownerContext.request.get(`${quizUrl}/export`);
    expect(exportResponse.ok()).toBe(true);
    expect(exportResponse.headers()["content-type"]).toContain("text/csv");
    const csvText = await exportResponse.text();
    expect(csvText).toContain(`${removalStudentName},submitted,2,3,`);

    // --- Remove that student from the roster ---
    // Note: the server action's refresh() re-renders the whole roster list
    // as soon as the delete lands, so the removed row (and the dialog's
    // own "success" text inside it) disappears in the same update rather
    // than lingering — the row vanishing IS the success signal here,
    // unlike archive actions elsewhere which keep the row and just relabel
    // it.
    await ownerPage.goto(`${baseUrl}/admin/courses/${courseId}/roster`);
    const removalRow = ownerPage.getByRole("row", { name: new RegExp(removalStudentName) });
    await expect(removalRow).toBeVisible();
    await removalRow.getByRole("button", { name: "Remove" }).click();
    await ownerPage.getByRole("button", { name: "Remove student" }).click();
    await expect(removalRow).toHaveCount(0, { timeout: 10_000 });

    await ownerContext.close();

    // --- The other student self-unenrolls ---
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await studentPage.goto(`${baseUrl}/sign-in`);
    await studentPage.getByLabel("Email").fill(unenrollStudentEmail);
    await studentPage.getByLabel("Password").fill(password);
    await studentPage.getByRole("button", { name: "Sign in" }).click();
    await studentPage.waitForURL(`${baseUrl}/student`);

    await studentPage.goto(`${baseUrl}/student/courses/${courseId}`);
    // "Lessons" is a CardTitle (a styled <div>, not a semantic heading).
    await expect(studentPage.getByText("Lessons", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await studentPage.getByRole("button", { name: "Unenroll" }).click();
    await studentPage.getByRole("button", { name: "Confirm unenroll" }).click();
    // Same reasoning as the roster removal above: refresh() swaps the
    // whole page to the "not enrolled" branch as soon as the delete lands,
    // so this heading appearing (not a lingering success message) is the
    // success signal.
    await expect(studentPage.getByText("Enroll to start learning")).toBeVisible({
      timeout: 10_000,
    });

    await studentContext.close();
  });
});
