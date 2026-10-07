import { config as loadEnv } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });

// Same skip-gracefully-without-credentials convention as
// tenant-isolation.test.ts — see that file for why.
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

describe.skipIf(!CREDENTIALS_AVAILABLE)(
  "RLS: quiz engine — answer-key secrecy, server-owned clock, attempt limits (SECURITY.md §4)",
  () => {
    let admin: SupabaseClient;
    let instituteId: string;
    let instructorId: string;
    let studentId: string;
    let studentClient: SupabaseClient;
    let instructorClient: SupabaseClient;

    let courseId: string;
    let quizLimitedId: string; // max_attempts = 1, used for the attempt-limit test
    let quizForgeryId: string; // max_attempts = 5, used for the write-forging tests
    let questionLimitedId: string;
    let optionLimitedCorrectId: string;
    let questionForgeryId: string;
    let optionForgeryCorrectId: string;
    let optionForgeryWrongId: string;

    async function signIn(email: string, password: string): Promise<SupabaseClient> {
      const client = createClient(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(`sign-in failed: ${error.message}`);
      return client;
    }

    beforeAll(async () => {
      admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const subdomain = `quiz-rls-${RUN_ID}`;
      const { data: institute, error: instituteError } = await admin
        .from("institutes")
        .insert({ name: "Quiz RLS Test", subdomain })
        .select("id")
        .single();
      if (instituteError || !institute) {
        throw new Error(`fixture institute failed: ${instituteError?.message}`);
      }
      instituteId = institute.id;

      const instructorEmail = `quiz-rls-instructor-${RUN_ID}@example.com`;
      const studentEmail = `quiz-rls-student-${RUN_ID}@example.com`;
      const password = "correctHorse1Battery";

      const { data: instructorUser, error: instructorUserError } =
        await admin.auth.admin.createUser({
          email: instructorEmail,
          password,
          email_confirm: true,
        });
      if (instructorUserError || !instructorUser.user) {
        throw new Error(`fixture instructor user failed: ${instructorUserError?.message}`);
      }
      instructorId = instructorUser.user.id;

      const { data: studentUser, error: studentUserError } = await admin.auth.admin.createUser({
        email: studentEmail,
        password,
        email_confirm: true,
      });
      if (studentUserError || !studentUser.user) {
        throw new Error(`fixture student user failed: ${studentUserError?.message}`);
      }
      studentId = studentUser.user.id;

      const { error: profilesError } = await admin.from("profiles").insert([
        {
          id: instructorId,
          institute_id: instituteId,
          role: "instructor",
          full_name: "Quiz RLS Instructor",
        },
        {
          id: studentId,
          institute_id: instituteId,
          role: "student",
          full_name: "Quiz RLS Student",
        },
      ]);
      if (profilesError) throw new Error(`fixture profiles failed: ${profilesError.message}`);

      const { data: course, error: courseError } = await admin
        .from("courses")
        .insert({
          institute_id: instituteId,
          created_by: instructorId,
          title: "Quiz RLS Course",
          status: "published",
        })
        .select("id")
        .single();
      if (courseError || !course) throw new Error(`fixture course failed: ${courseError?.message}`);
      courseId = course.id;

      const { error: enrollmentError } = await admin.from("enrollments").insert({
        institute_id: instituteId,
        course_id: courseId,
        student_id: studentId,
      });
      if (enrollmentError) {
        throw new Error(`fixture enrollment failed: ${enrollmentError.message}`);
      }

      const { data: quizzes, error: quizzesError } = await admin
        .from("quizzes")
        .insert([
          {
            institute_id: instituteId,
            course_id: courseId,
            created_by: instructorId,
            title: "Limited attempts quiz",
            status: "published",
            duration_seconds: 600,
            max_attempts: 1,
          },
          {
            institute_id: instituteId,
            course_id: courseId,
            created_by: instructorId,
            title: "Forgery test quiz",
            status: "published",
            duration_seconds: 600,
            max_attempts: 5,
          },
        ])
        .select("id, title");
      if (quizzesError || !quizzes) throw new Error(`fixture quizzes failed: ${quizzesError?.message}`);
      quizLimitedId = quizzes.find((q) => q.title === "Limited attempts quiz")!.id;
      quizForgeryId = quizzes.find((q) => q.title === "Forgery test quiz")!.id;

      const { data: questions, error: questionsError } = await admin
        .from("quiz_questions")
        .insert([
          { institute_id: instituteId, quiz_id: quizLimitedId, question_text: "2 + 2?" },
          { institute_id: instituteId, quiz_id: quizForgeryId, question_text: "3 + 3?" },
        ])
        .select("id, quiz_id");
      if (questionsError || !questions) {
        throw new Error(`fixture questions failed: ${questionsError?.message}`);
      }
      questionLimitedId = questions.find((q) => q.quiz_id === quizLimitedId)!.id;
      questionForgeryId = questions.find((q) => q.quiz_id === quizForgeryId)!.id;

      const { data: limitedOptions, error: limitedOptionsError } = await admin
        .from("quiz_question_options")
        .insert([
          { institute_id: instituteId, question_id: questionLimitedId, position: 0, option_text: "4" },
          { institute_id: instituteId, question_id: questionLimitedId, position: 1, option_text: "5" },
        ])
        .select("id, position");
      if (limitedOptionsError || !limitedOptions) {
        throw new Error(`fixture limited options failed: ${limitedOptionsError?.message}`);
      }
      optionLimitedCorrectId = limitedOptions.find((o) => o.position === 0)!.id;

      const { data: forgeryOptions, error: forgeryOptionsError } = await admin
        .from("quiz_question_options")
        .insert([
          { institute_id: instituteId, question_id: questionForgeryId, position: 0, option_text: "6" },
          { institute_id: instituteId, question_id: questionForgeryId, position: 1, option_text: "7" },
        ])
        .select("id, position");
      if (forgeryOptionsError || !forgeryOptions) {
        throw new Error(`fixture forgery options failed: ${forgeryOptionsError?.message}`);
      }
      optionForgeryCorrectId = forgeryOptions.find((o) => o.position === 0)!.id;
      optionForgeryWrongId = forgeryOptions.find((o) => o.position === 1)!.id;

      const { error: keysError } = await admin.from("quiz_answer_keys").insert([
        {
          institute_id: instituteId,
          question_id: questionLimitedId,
          correct_option_ids: [optionLimitedCorrectId],
        },
        {
          institute_id: instituteId,
          question_id: questionForgeryId,
          correct_option_ids: [optionForgeryCorrectId],
        },
      ]);
      if (keysError) throw new Error(`fixture answer keys failed: ${keysError.message}`);

      studentClient = await signIn(studentEmail, password);
      instructorClient = await signIn(instructorEmail, password);
    }, 30_000);

    afterAll(async () => {
      // Delete children before parents, and never rely on auth.users'
      // cascade to profiles landing before anything else reads/references
      // it — see the teardown race fixed in tenant-isolation.test.ts.
      const warn = (label: string, error: { message: string } | null) => {
        if (error) console.warn(`cleanup: ${label} failed: ${error.message}`);
      };

      if (instituteId) {
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
        warn("courses", (await admin.from("courses").delete().eq("institute_id", instituteId)).error);
        warn(
          "audit_logs",
          (await admin.from("audit_logs").delete().eq("institute_id", instituteId)).error,
        );
      }
      if (studentId) warn("student profile", (await admin.from("profiles").delete().eq("id", studentId)).error);
      if (instructorId) {
        warn("instructor profile", (await admin.from("profiles").delete().eq("id", instructorId)).error);
      }
      if (instituteId) {
        warn("institute", (await admin.from("institutes").delete().eq("id", instituteId)).error);
      }
      if (studentId) warn("student auth user", (await admin.auth.admin.deleteUser(studentId)).error);
      if (instructorId) {
        warn("instructor auth user", (await admin.auth.admin.deleteUser(instructorId)).error);
      }
    }, 30_000);

    it("a student cannot read quiz_answer_keys — RLS silently filters, no error", async () => {
      const { data, error } = await studentClient
        .from("quiz_answer_keys")
        .select("id")
        .eq("question_id", questionLimitedId);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("the instructor who created the quiz can read its answer key", async () => {
      const { data, error } = await instructorClient
        .from("quiz_answer_keys")
        .select("id, correct_option_ids")
        .eq("question_id", questionLimitedId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.correct_option_ids).toEqual([optionLimitedCorrectId]);
    });

    it("a student can start an attempt with real, matching values", async () => {
      const { data, error } = await studentClient
        .from("quiz_attempts")
        .insert({
          institute_id: instituteId,
          quiz_id: quizLimitedId,
          student_id: studentId,
          duration_seconds: 600,
          grace_seconds: 30,
          question_order: [questionLimitedId],
          option_order: {},
          seed: 1,
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
    });

    it("starting a second attempt past max_attempts is rejected", async () => {
      const { error } = await studentClient.from("quiz_attempts").insert({
        institute_id: instituteId,
        quiz_id: quizLimitedId,
        student_id: studentId,
        duration_seconds: 600,
        grace_seconds: 30,
        question_order: [questionLimitedId],
        option_order: {},
        seed: 2,
      });
      expect(error).not.toBeNull();
    });

    it("a student cannot forge duration_seconds to extend their own time limit", async () => {
      const { error } = await studentClient.from("quiz_attempts").insert({
        institute_id: instituteId,
        quiz_id: quizForgeryId,
        student_id: studentId,
        duration_seconds: 999_999,
        grace_seconds: 30,
        question_order: [questionForgeryId],
        option_order: {},
        seed: 3,
      });
      expect(error).not.toBeNull();
    });

    it("a student cannot forge status/score on insert (regression test for the fixed privilege-escalation gap)", async () => {
      const { error } = await studentClient.from("quiz_attempts").insert({
        institute_id: instituteId,
        quiz_id: quizForgeryId,
        student_id: studentId,
        duration_seconds: 600,
        grace_seconds: 30,
        question_order: [questionForgeryId],
        option_order: {},
        seed: 4,
        status: "submitted",
        score: 999,
        max_score: 1,
        submitted_at: new Date().toISOString(),
      });
      expect(error).not.toBeNull();
    });

    it("a student cannot update their own attempt directly to set a score — no update policy exists at all", async () => {
      const { data: attempt, error: insertError } = await studentClient
        .from("quiz_attempts")
        .insert({
          institute_id: instituteId,
          quiz_id: quizForgeryId,
          student_id: studentId,
          duration_seconds: 600,
          grace_seconds: 30,
          question_order: [questionForgeryId],
          option_order: {},
          seed: 5,
        })
        .select("id")
        .single();
      expect(insertError).toBeNull();
      expect(attempt?.id).toBeTruthy();

      const { error: updateError, data: updateData } = await studentClient
        .from("quiz_attempts")
        .update({ status: "submitted", score: 999, max_score: 1 })
        .eq("id", attempt!.id)
        .select("id");

      // RLS with no matching policy means the update affects zero rows
      // rather than necessarily returning a Postgres error.
      expect(updateError).toBeNull();
      expect(updateData ?? []).toHaveLength(0);

      const { data: unchanged } = await admin
        .from("quiz_attempts")
        .select("status, score")
        .eq("id", attempt!.id)
        .single();
      expect(unchanged?.status).toBe("in_progress");
      expect(unchanged?.score).toBeNull();
    });

    it("a late answer write is rejected by the database, regardless of application code", async () => {
      // duration_seconds/grace_seconds must match the quiz's real values
      // (0019 pins them) — so to simulate a timeout we insert normally and
      // then backdate started_at via the service-role client, rather than
      // forging a short duration at insert time (which 0019 now rejects).
      const { data: attempt, error: insertError } = await studentClient
        .from("quiz_attempts")
        .insert({
          institute_id: instituteId,
          quiz_id: quizForgeryId,
          student_id: studentId,
          duration_seconds: 600,
          grace_seconds: 30,
          question_order: [questionForgeryId],
          option_order: {},
          seed: 6,
        })
        .select("id")
        .single();
      expect(insertError).toBeNull();

      const { error: backdateError } = await admin
        .from("quiz_attempts")
        .update({ started_at: new Date(Date.now() - 700_000).toISOString() })
        .eq("id", attempt!.id);
      expect(backdateError).toBeNull();

      const { error: answerError } = await studentClient.from("quiz_attempt_answers").insert({
        institute_id: instituteId,
        attempt_id: attempt!.id,
        question_id: questionForgeryId,
        selected_option_ids: [optionForgeryCorrectId],
      });
      expect(answerError).not.toBeNull();
    });

    it("an answer cannot reference a question from a different quiz", async () => {
      const { data: attempt, error: insertError } = await studentClient
        .from("quiz_attempts")
        .insert({
          institute_id: instituteId,
          quiz_id: quizForgeryId,
          student_id: studentId,
          duration_seconds: 600,
          grace_seconds: 30,
          question_order: [questionForgeryId],
          option_order: {},
          seed: 7,
        })
        .select("id")
        .single();
      expect(insertError).toBeNull();

      // questionLimitedId belongs to quizLimitedId, not this attempt's
      // quizForgeryId.
      const { error: answerError } = await studentClient.from("quiz_attempt_answers").insert({
        institute_id: instituteId,
        attempt_id: attempt!.id,
        question_id: questionLimitedId,
        selected_option_ids: [optionLimitedCorrectId],
      });
      expect(answerError).not.toBeNull();
    });

    it("a valid, on-time answer write succeeds", async () => {
      const { data: attempt, error: insertError } = await studentClient
        .from("quiz_attempts")
        .insert({
          institute_id: instituteId,
          quiz_id: quizForgeryId,
          student_id: studentId,
          duration_seconds: 600,
          grace_seconds: 30,
          question_order: [questionForgeryId],
          option_order: {},
          seed: 8,
        })
        .select("id")
        .single();
      expect(insertError).toBeNull();

      const { error: answerError } = await studentClient.from("quiz_attempt_answers").insert({
        institute_id: instituteId,
        attempt_id: attempt!.id,
        question_id: questionForgeryId,
        selected_option_ids: [optionForgeryWrongId],
      });
      expect(answerError).toBeNull();
    });
  },
);
