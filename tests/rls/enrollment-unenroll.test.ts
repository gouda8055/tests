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
  "RLS: enrollments_delete — unenroll (Stage 4, SECURITY.md §1)",
  () => {
    let admin: SupabaseClient;

    let instituteAId: string;
    let courseA1Id: string;
    let ownerAId: string;
    let instructorA1Id: string; // created courseA1
    let instructorA2Id: string; // did NOT create courseA1
    let studentA1Id: string;
    let studentA2Id: string;

    let instituteZId: string;
    let ownerZId: string;

    let ownerAClient: SupabaseClient;
    let instructorA1Client: SupabaseClient;
    let instructorA2Client: SupabaseClient;
    let studentA1Client: SupabaseClient;
    let studentA2Client: SupabaseClient;
    let ownerZClient: SupabaseClient;

    const password = "correctHorse1Battery";

    async function signIn(email: string): Promise<SupabaseClient> {
      const client = createClient(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
      return client;
    }

    async function createUser(email: string) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`createUser failed for ${email}: ${error?.message}`);
      return data.user.id;
    }

    /** Fresh enrollment row for one test, so tests never depend on each other's ordering. */
    async function insertEnrollment(studentId: string) {
      const { data, error } = await admin
        .from("enrollments")
        .insert({ institute_id: instituteAId, course_id: courseA1Id, student_id: studentId })
        .select("id")
        .single();
      if (error || !data) throw new Error(`insertEnrollment failed: ${error?.message}`);
      return data.id as string;
    }

    /**
     * A "the delete is rejected" test deliberately leaves the row behind —
     * clean it up via admin afterward so a later test can insert a fresh
     * row for the same (course, student) pair without tripping
     * enrollments_course_student_unique.
     */
    async function cleanupEnrollment(enrollmentId: string) {
      await admin.from("enrollments").delete().eq("id", enrollmentId);
    }

    beforeAll(async () => {
      admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: instituteA, error: instituteAError } = await admin
        .from("institutes")
        .insert({ name: "Unenroll Test A", subdomain: `unenroll-a-${RUN_ID}` })
        .select("id")
        .single();
      if (instituteAError || !instituteA) {
        throw new Error(`fixture institute A failed: ${instituteAError?.message}`);
      }
      instituteAId = instituteA.id;

      const { data: instituteZ, error: instituteZError } = await admin
        .from("institutes")
        .insert({ name: "Unenroll Test Z", subdomain: `unenroll-z-${RUN_ID}` })
        .select("id")
        .single();
      if (instituteZError || !instituteZ) {
        throw new Error(`fixture institute Z failed: ${instituteZError?.message}`);
      }
      instituteZId = instituteZ.id;

      const ownerAEmail = `unenroll-owner-a-${RUN_ID}@example.com`;
      const instructorA1Email = `unenroll-instructor-a1-${RUN_ID}@example.com`;
      const instructorA2Email = `unenroll-instructor-a2-${RUN_ID}@example.com`;
      const studentA1Email = `unenroll-student-a1-${RUN_ID}@example.com`;
      const studentA2Email = `unenroll-student-a2-${RUN_ID}@example.com`;
      const ownerZEmail = `unenroll-owner-z-${RUN_ID}@example.com`;

      [ownerAId, instructorA1Id, instructorA2Id, studentA1Id, studentA2Id, ownerZId] =
        await Promise.all([
          createUser(ownerAEmail),
          createUser(instructorA1Email),
          createUser(instructorA2Email),
          createUser(studentA1Email),
          createUser(studentA2Email),
          createUser(ownerZEmail),
        ]);

      const { error: profilesError } = await admin.from("profiles").insert([
        { id: ownerAId, institute_id: instituteAId, role: "institute_owner", full_name: "Owner A" },
        {
          id: instructorA1Id,
          institute_id: instituteAId,
          role: "instructor",
          full_name: "Instructor A1",
        },
        {
          id: instructorA2Id,
          institute_id: instituteAId,
          role: "instructor",
          full_name: "Instructor A2",
        },
        { id: studentA1Id, institute_id: instituteAId, role: "student", full_name: "Student A1" },
        { id: studentA2Id, institute_id: instituteAId, role: "student", full_name: "Student A2" },
        { id: ownerZId, institute_id: instituteZId, role: "institute_owner", full_name: "Owner Z" },
      ]);
      if (profilesError) throw new Error(`fixture profiles failed: ${profilesError.message}`);

      const { data: courseA1, error: courseA1Error } = await admin
        .from("courses")
        .insert({
          institute_id: instituteAId,
          created_by: instructorA1Id,
          title: "Unenroll Course A1",
          status: "published",
        })
        .select("id")
        .single();
      if (courseA1Error || !courseA1) throw new Error(`fixture course failed: ${courseA1Error?.message}`);
      courseA1Id = courseA1.id;

      [ownerAClient, instructorA1Client, instructorA2Client, studentA1Client, studentA2Client, ownerZClient] =
        await Promise.all([
          signIn(ownerAEmail),
          signIn(instructorA1Email),
          signIn(instructorA2Email),
          signIn(studentA1Email),
          signIn(studentA2Email),
          signIn(ownerZEmail),
        ]);
    }, 30_000);

    afterAll(async () => {
      const warn = (label: string, error: { message: string } | null) => {
        if (error) console.warn(`cleanup: ${label} failed: ${error.message}`);
      };

      if (instituteAId) {
        warn(
          "enrollments A",
          (await admin.from("enrollments").delete().eq("institute_id", instituteAId)).error,
        );
        warn("courses A", (await admin.from("courses").delete().eq("institute_id", instituteAId)).error);
        warn(
          "audit_logs A",
          (await admin.from("audit_logs").delete().eq("institute_id", instituteAId)).error,
        );
      }

      const allProfileIds = [
        ownerAId,
        instructorA1Id,
        instructorA2Id,
        studentA1Id,
        studentA2Id,
        ownerZId,
      ].filter(Boolean);
      for (const id of allProfileIds) {
        warn(`profile ${id}`, (await admin.from("profiles").delete().eq("id", id)).error);
      }
      if (instituteAId) {
        warn("institute A", (await admin.from("institutes").delete().eq("id", instituteAId)).error);
      }
      if (instituteZId) {
        warn("institute Z", (await admin.from("institutes").delete().eq("id", instituteZId)).error);
      }
      for (const id of allProfileIds) {
        warn(`auth user ${id}`, (await admin.auth.admin.deleteUser(id)).error);
      }
    });

    it("a student can delete their own enrollment", async () => {
      const enrollmentId = await insertEnrollment(studentA1Id);

      const { data, error } = await studentA1Client
        .from("enrollments")
        .delete()
        .eq("id", enrollmentId)
        .select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);

      const { data: gone } = await admin.from("enrollments").select("id").eq("id", enrollmentId);
      expect(gone).toHaveLength(0);
    });

    it("a student cannot delete another student's enrollment", async () => {
      const enrollmentId = await insertEnrollment(studentA1Id);

      const { data, error } = await studentA2Client
        .from("enrollments")
        .delete()
        .eq("id", enrollmentId)
        .select("id");
      // RLS with no matching row means 0 rows affected, not necessarily an error.
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);

      const { data: stillThere } = await admin
        .from("enrollments")
        .select("id")
        .eq("id", enrollmentId);
      expect(stillThere).toHaveLength(1);
      await cleanupEnrollment(enrollmentId);
    });

    it("the instructor who created the course can remove a student's enrollment", async () => {
      const enrollmentId = await insertEnrollment(studentA1Id);

      const { data, error } = await instructorA1Client
        .from("enrollments")
        .delete()
        .eq("id", enrollmentId)
        .select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("an instructor who did NOT create the course cannot remove a student's enrollment", async () => {
      const enrollmentId = await insertEnrollment(studentA1Id);

      const { data, error } = await instructorA2Client
        .from("enrollments")
        .delete()
        .eq("id", enrollmentId)
        .select("id");
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);

      const { data: stillThere } = await admin
        .from("enrollments")
        .select("id")
        .eq("id", enrollmentId);
      expect(stillThere).toHaveLength(1);
      await cleanupEnrollment(enrollmentId);
    });

    it("institute_owner can remove any enrollment in their institute, even in a course they didn't create", async () => {
      const enrollmentId = await insertEnrollment(studentA2Id);

      const { data, error } = await ownerAClient
        .from("enrollments")
        .delete()
        .eq("id", enrollmentId)
        .select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("a different institute's owner cannot remove this institute's enrollment", async () => {
      const enrollmentId = await insertEnrollment(studentA1Id);

      const { data, error } = await ownerZClient
        .from("enrollments")
        .delete()
        .eq("id", enrollmentId)
        .select("id");
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);

      const { data: stillThere } = await admin
        .from("enrollments")
        .select("id")
        .eq("id", enrollmentId);
      expect(stillThere).toHaveLength(1);
      await cleanupEnrollment(enrollmentId);
    });
  },
);
