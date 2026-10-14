import { config as loadEnv } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

describe.skipIf(!CREDENTIALS_AVAILABLE)(
  "RLS: short_answer questions (Stage 5, 0025_short_answer_questions.sql)",
  () => {
    let admin: SupabaseClient;
    let instituteId: string;
    let instructorId: string;
    let studentId: string;
    let studentClient: SupabaseClient;
    let instructorClient: SupabaseClient;
    let courseId: string;
    let quizId: string;
    let questionId: string;

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

      const subdomain = `short-answer-${RUN_ID}`;
      const { data: institute, error: instituteError } = await admin
        .from("institutes")
        .insert({ name: "Short Answer Test", subdomain })
        .select("id")
        .single();
      if (instituteError || !institute) throw new Error(`fixture institute failed: ${instituteError?.message}`);
      instituteId = institute.id;

      const instructorEmail = `short-answer-instructor-${RUN_ID}@example.com`;
      const studentEmail = `short-answer-student-${RUN_ID}@example.com`;
      const password = "correctHorse1Battery";

      const { data: instructorUser, error: instructorError } = await admin.auth.admin.createUser({
        email: instructorEmail,
        password,
        email_confirm: true,
      });
      if (instructorError || !instructorUser.user) throw new Error(`fixture instructor failed: ${instructorError?.message}`);
      instructorId = instructorUser.user.id;

      const { data: studentUser, error: studentError } = await admin.auth.admin.createUser({
        email: studentEmail,
        password,
        email_confirm: true,
      });
      if (studentError || !studentUser.user) throw new Error(`fixture student failed: ${studentError?.message}`);
      studentId = studentUser.user.id;

      const { error: profilesError } = await admin.from("profiles").insert([
        { id: instructorId, institute_id: instituteId, role: "instructor", full_name: "SA Instructor" },
        { id: studentId, institute_id: instituteId, role: "student", full_name: "SA Student" },
      ]);
      if (profilesError) throw new Error(`fixture profiles failed: ${profilesError.message}`);

      const { data: course, error: courseError } = await admin
        .from("courses")
        .insert({
          institute_id: instituteId,
          created_by: instructorId,
          title: "Short Answer Course",
          status: "published",
        })
        .select("id")
        .single();
      if (courseError || !course) throw new Error(`fixture course failed: ${courseError?.message}`);
      courseId = course.id as string;

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
          title: "Short Answer Quiz",
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
        .insert({
          institute_id: instituteId,
          quiz_id: quizId,
          question_text: "What is the capital of France?",
          question_type: "short_answer",
          points: 2,
        })
        .select("id")
        .single();
      if (questionError || !question) throw new Error(`fixture question failed: ${questionError?.message}`);
      questionId = question.id as string;

      const { error: keyError } = await admin.from("quiz_answer_keys").insert({
        institute_id: instituteId,
        question_id: questionId,
        correct_text_answers: ["Paris", "Lutetia"],
      });
      if (keyError) throw new Error(`fixture answer key failed: ${keyError.message}`);

      studentClient = await signIn(studentEmail, password);
      instructorClient = await signIn(instructorEmail, password);
    }, 30_000);

    afterAll(async () => {
      if (!instituteId) return;
      const warn = (label: string, error: { message: string } | null) => {
        if (error) console.warn(`cleanup: ${label} failed: ${error.message}`);
      };
      warn("quiz_attempt_answers", (await admin.from("quiz_attempt_answers").delete().eq("institute_id", instituteId)).error);
      warn("quiz_attempts", (await admin.from("quiz_attempts").delete().eq("institute_id", instituteId)).error);
      warn("quiz_answer_keys", (await admin.from("quiz_answer_keys").delete().eq("institute_id", instituteId)).error);
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

    it("a student cannot read a short_answer question's answer key — RLS silently filters", async () => {
      const { data, error } = await studentClient
        .from("quiz_answer_keys")
        .select("id, correct_text_answers")
        .eq("question_id", questionId);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("the instructor who created the quiz can read the short_answer key", async () => {
      const { data, error } = await instructorClient
        .from("quiz_answer_keys")
        .select("correct_text_answers")
        .eq("question_id", questionId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0]!.correct_text_answers).toEqual(["Paris", "Lutetia"]);
    });

    it("rejects an answer key row with both an option-shaped and a text-shaped answer", async () => {
      const { error } = await admin.from("quiz_answer_keys").insert({
        institute_id: instituteId,
        question_id: questionId,
        correct_option_ids: ["00000000-0000-0000-0000-000000000000"],
        correct_text_answers: ["Paris"],
      });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/quiz_answer_keys_exactly_one_answer_shape|correct_option_ids|unique/i);
    });

    it("rejects an answer key row with neither shape populated", async () => {
      const { data: bareQuestion, error: questionError } = await admin
        .from("quiz_questions")
        .insert({
          institute_id: instituteId,
          quiz_id: quizId,
          question_text: "Unkeyed question",
          question_type: "short_answer",
          points: 1,
        })
        .select("id")
        .single();
      expect(questionError).toBeNull();

      const { error } = await admin.from("quiz_answer_keys").insert({
        institute_id: instituteId,
        question_id: bareQuestion!.id,
        correct_option_ids: null,
        correct_text_answers: null,
      });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/quiz_answer_keys_exactly_one_answer_shape/);
    });

    it("a student can save a text_answer within the deadline", async () => {
      const { data: attempt, error: attemptError } = await studentClient
        .from("quiz_attempts")
        .insert({
          institute_id: instituteId,
          quiz_id: quizId,
          student_id: studentId,
          duration_seconds: 600,
          grace_seconds: 30,
          question_order: [questionId],
          option_order: {},
          seed: 1,
        })
        .select("id")
        .single();
      expect(attemptError).toBeNull();

      const { data: saved, error: saveError } = await studentClient
        .from("quiz_attempt_answers")
        .insert({
          institute_id: instituteId,
          attempt_id: attempt!.id,
          question_id: questionId,
          selected_option_ids: [],
          text_answer: "  PARIS  ",
        })
        .select("id, text_answer, selected_option_ids");
      expect(saveError).toBeNull();
      expect(saved).toHaveLength(1);
      expect(saved![0]!.text_answer).toBe("  PARIS  ");
      expect(saved![0]!.selected_option_ids).toEqual([]);
    });

    it("a late text_answer write is rejected by the database regardless of application code", async () => {
      const { data: attempt, error: attemptError } = await studentClient
        .from("quiz_attempts")
        .insert({
          institute_id: instituteId,
          quiz_id: quizId,
          student_id: studentId,
          duration_seconds: 600,
          grace_seconds: 30,
          question_order: [questionId],
          option_order: {},
          seed: 2,
        })
        .select("id")
        .single();
      expect(attemptError).toBeNull();

      const { error: backdateError } = await admin
        .from("quiz_attempts")
        .update({ started_at: new Date(Date.now() - 700_000).toISOString() })
        .eq("id", attempt!.id);
      expect(backdateError).toBeNull();

      const { error: answerError } = await studentClient.from("quiz_attempt_answers").insert({
        institute_id: instituteId,
        attempt_id: attempt!.id,
        question_id: questionId,
        selected_option_ids: [],
        text_answer: "Paris",
      });
      expect(answerError).not.toBeNull();
    });
  },
);
