import { config as loadEnv } from "dotenv";
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });

// Same skip-gracefully-without-credentials convention as the other e2e
// spec, plus CRON_SECRET since this route refuses to run without it.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const CREDENTIALS_AVAILABLE = Boolean(
  SUPABASE_URL &&
  ANON_KEY &&
  SERVICE_ROLE_KEY &&
  SERVICE_ROLE_KEY !== "sandbox-local-dummy-not-a-real-secret" &&
  CRON_SECRET,
);

// This hits the route directly over HTTP (no browser page needed) rather
// than importing finalizeAllExpiredAttempts()/finalizeIfExpired() as plain
// functions: both call next/headers' headers(), which only works inside a
// real Next.js request-handling scope. A bare function call from Vitest has
// no such scope and throws "headers() was called outside a request scope"
// — the dev server Playwright already manages (see webServer in
// playwright.config.ts) is what actually provides that context, so this is
// the right layer to test this route at, the same way course-quiz-flow
// needs a real browser instead of a JS-disabled context.
test.describe("Stage 3: GET /api/cron/finalize-expired-attempts", () => {
  test.skip(
    !CREDENTIALS_AVAILABLE,
    "Requires a real SUPABASE_SERVICE_ROLE_KEY and CRON_SECRET in .env.local",
  );

  let admin: SupabaseClient;
  let instituteId: string;
  let studentId: string;
  let quizId: string;
  let questionId: string;
  const runId = Date.now().toString(36);

  test.beforeAll(async () => {
    if (!CREDENTIALS_AVAILABLE) return;

    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const subdomain = `cron-finalize-${runId}`;
    const { data: institute, error: instituteError } = await admin
      .from("institutes")
      .insert({ name: "Cron Finalize Institute", subdomain })
      .select("id")
      .single();
    if (instituteError || !institute) throw new Error(`fixture institute failed: ${instituteError?.message}`);
    instituteId = institute.id;

    const instructorEmail = `cron-instructor-${runId}@example.com`;
    const studentEmail = `cron-student-${runId}@example.com`;
    const password = "correctHorse1Battery";

    const { data: instructorUser, error: instructorError } = await admin.auth.admin.createUser({
      email: instructorEmail,
      password,
      email_confirm: true,
    });
    if (instructorError || !instructorUser.user) throw new Error(`fixture instructor failed: ${instructorError?.message}`);
    const instructorId = instructorUser.user.id;

    const { data: studentUser, error: studentError } = await admin.auth.admin.createUser({
      email: studentEmail,
      password,
      email_confirm: true,
    });
    if (studentError || !studentUser.user) throw new Error(`fixture student failed: ${studentError?.message}`);
    studentId = studentUser.user.id;

    const { error: profilesError } = await admin.from("profiles").insert([
      { id: instructorId, institute_id: instituteId, role: "instructor", full_name: "Cron Instructor" },
      { id: studentId, institute_id: instituteId, role: "student", full_name: "Cron Student" },
    ]);
    if (profilesError) throw new Error(`fixture profiles failed: ${profilesError.message}`);

    const { data: course, error: courseError } = await admin
      .from("courses")
      .insert({ institute_id: instituteId, created_by: instructorId, title: "Cron Finalize Course", status: "published" })
      .select("id")
      .single();
    if (courseError || !course) throw new Error(`fixture course failed: ${courseError?.message}`);
    const courseId = course.id as string;

    const { error: enrollmentError } = await admin
      .from("enrollments")
      .insert({ institute_id: instituteId, course_id: courseId, student_id: studentId });
    if (enrollmentError) throw new Error(`fixture enrollment failed: ${enrollmentError.message}`);

    const { data: quiz, error: quizError } = await admin
      .from("quizzes")
      .insert({
        institute_id: instituteId,
        course_id: courseId,
        created_by: instructorId,
        title: "Cron Finalize Quiz",
        status: "published",
        duration_seconds: 600,
        grace_seconds: 30,
        max_attempts: 5,
      })
      .select("id")
      .single();
    if (quizError || !quiz) throw new Error(`fixture quiz failed: ${quizError?.message}`);
    quizId = quiz.id as string;

    const { data: question, error: questionError } = await admin
      .from("quiz_questions")
      .insert({ institute_id: instituteId, quiz_id: quizId, question_text: "1 + 1?", points: 1 })
      .select("id")
      .single();
    if (questionError || !question) throw new Error(`fixture question failed: ${questionError?.message}`);
    questionId = question.id as string;

    const { data: options, error: optionsError } = await admin
      .from("quiz_question_options")
      .insert([
        { institute_id: instituteId, question_id: questionId, position: 0, option_text: "2" },
        { institute_id: instituteId, question_id: questionId, position: 1, option_text: "3" },
      ])
      .select("id, position");
    if (optionsError || !options) throw new Error(`fixture options failed: ${optionsError?.message}`);
    const correctOptionId = options.find((o) => o.position === 0)!.id as string;

    const { error: keyError } = await admin
      .from("quiz_answer_keys")
      .insert({ institute_id: instituteId, question_id: questionId, correct_option_ids: [correctOptionId] });
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

  test("rejects a request with no/wrong secret, finalizes a stale attempt with the right one, and is idempotent", async ({
    request,
    baseURL,
  }) => {
    const url = `${baseURL}/api/cron/finalize-expired-attempts`;

    // --- Wrong/missing secret: 401, and must not touch anything ---
    const unauthed = await request.get(url);
    expect(unauthed.status()).toBe(401);
    const wrongSecret = await request.get(url, { headers: { authorization: "Bearer not-the-secret" } });
    expect(wrongSecret.status()).toBe(401);

    // --- Seed a stale in_progress attempt, backdated past its deadline ---
    const { data: attempt, error: insertError } = await admin
      .from("quiz_attempts")
      .insert({
        institute_id: instituteId,
        quiz_id: quizId,
        student_id: studentId,
        status: "in_progress",
        started_at: new Date(Date.now() - 700_000).toISOString(), // duration 600 + grace 30 < 700s ago
        duration_seconds: 600,
        grace_seconds: 30,
        question_order: [questionId],
        option_order: {},
        seed: 1,
      })
      .select("id")
      .single();
    expect(insertError).toBeNull();
    const attemptId = attempt!.id as string;

    // --- Right secret: sweeps and grades it ---
    const authed = await request.get(url, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(authed.ok()).toBe(true);
    const body = await authed.json();
    expect(body.checked).toBeGreaterThanOrEqual(1);
    expect(body.finalized).toBeGreaterThanOrEqual(1);

    const { data: finalized } = await admin
      .from("quiz_attempts")
      .select("status, score, max_score, submitted_at")
      .eq("id", attemptId)
      .single();
    expect(finalized?.status).toBe("timed_out");
    expect(finalized?.score).toBe(0);
    expect(finalized?.max_score).toBe(1);
    expect(finalized?.submitted_at).toBeTruthy();

    // --- Idempotent: a second sweep leaves this attempt untouched ---
    await request.get(url, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    const { data: unchanged } = await admin
      .from("quiz_attempts")
      .select("status, submitted_at")
      .eq("id", attemptId)
      .single();
    expect(unchanged?.status).toBe("timed_out");
    expect(unchanged?.submitted_at).toBe(finalized?.submitted_at);
  });
});
