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
  "RLS: max_attempts concurrency race (Stage 5, 0022_fix_attempt_limit_race.sql)",
  () => {
    let admin: SupabaseClient;
    let studentClient: SupabaseClient;
    let instituteId: string;
    let studentId: string;
    let quizId: string;

    beforeAll(async () => {
      admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const subdomain = `attempt-race-${RUN_ID}`;
      const { data: institute, error: instituteError } = await admin
        .from("institutes")
        .insert({ name: "Attempt Race Test", subdomain })
        .select("id")
        .single();
      if (instituteError || !institute) throw new Error(`fixture institute failed: ${instituteError?.message}`);
      instituteId = institute.id;

      const instructorEmail = `attempt-race-instructor-${RUN_ID}@example.com`;
      const studentEmail = `attempt-race-student-${RUN_ID}@example.com`;
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
        { id: instructorId, institute_id: instituteId, role: "instructor", full_name: "Race Instructor" },
        { id: studentId, institute_id: instituteId, role: "student", full_name: "Race Student" },
      ]);
      if (profilesError) throw new Error(`fixture profiles failed: ${profilesError.message}`);

      const { data: course, error: courseError } = await admin
        .from("courses")
        .insert({
          institute_id: instituteId,
          created_by: instructorId,
          title: "Attempt Race Course",
          status: "published",
        })
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
          title: "Attempt Race Quiz",
          status: "published",
          duration_seconds: 600,
          grace_seconds: 30,
          max_attempts: 1,
        })
        .select("id")
        .single();
      if (quizError || !quiz) throw new Error(`fixture quiz failed: ${quizError?.message}`);
      quizId = quiz.id as string;

      const client = createClient(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInError } = await client.auth.signInWithPassword({
        email: studentEmail,
        password,
      });
      if (signInError) throw new Error(`sign-in failed: ${signInError.message}`);
      studentClient = client;
    }, 30_000);

    afterAll(async () => {
      if (!instituteId) return;
      const warn = (label: string, error: { message: string } | null) => {
        if (error) console.warn(`cleanup: ${label} failed: ${error.message}`);
      };
      warn("quiz_attempts", (await admin.from("quiz_attempts").delete().eq("institute_id", instituteId)).error);
      warn("enrollments", (await admin.from("enrollments").delete().eq("institute_id", instituteId)).error);
      warn("quizzes", (await admin.from("quizzes").delete().eq("institute_id", instituteId)).error);
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

    it("two truly simultaneous insert attempts against max_attempts=1 can't both succeed", async () => {
      const attemptRow = (seed: number) => ({
        institute_id: instituteId,
        quiz_id: quizId,
        student_id: studentId,
        duration_seconds: 600,
        grace_seconds: 30,
        question_order: [],
        option_order: {},
        seed,
      });

      // Fired via Promise.all (not sequentially) so both requests are
      // genuinely in flight at once — a sequential pair would never
      // exercise the race the 0022 trigger exists to close.
      const [first, second] = await Promise.all([
        studentClient.from("quiz_attempts").insert(attemptRow(1)).select("id"),
        studentClient.from("quiz_attempts").insert(attemptRow(2)).select("id"),
      ]);

      const succeeded = [first, second].filter((r) => !r.error && (r.data?.length ?? 0) > 0);
      const failed = [first, second].filter((r) => r.error);
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);

      const { data: rows } = await admin
        .from("quiz_attempts")
        .select("id")
        .eq("quiz_id", quizId)
        .eq("student_id", studentId);
      expect(rows).toHaveLength(1);
    });
  },
);
