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
  "RLS: certificates of completion (Stage 8, 0027_certificates.sql)",
  () => {
    let admin: SupabaseClient;
    let instituteId: string;
    let otherInstituteId: string;
    let instructorId: string;
    let studentAId: string;
    let studentBId: string;
    let outsiderInstructorId: string;
    let studentAClient: SupabaseClient;
    let studentBClient: SupabaseClient;
    let instructorClient: SupabaseClient;
    let outsiderInstructorClient: SupabaseClient;
    let courseId: string;
    let certificateAId: string;

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

      const { data: institute, error: instituteError } = await admin
        .from("institutes")
        .insert({ name: "Certificates Test", subdomain: `certs-${RUN_ID}` })
        .select("id")
        .single();
      if (instituteError || !institute) throw new Error(`fixture institute failed: ${instituteError?.message}`);
      instituteId = institute.id;

      const { data: otherInstitute, error: otherInstituteError } = await admin
        .from("institutes")
        .insert({ name: "Certificates Other Institute", subdomain: `certs-other-${RUN_ID}` })
        .select("id")
        .single();
      if (otherInstituteError || !otherInstitute) throw new Error(`fixture other institute failed: ${otherInstituteError?.message}`);
      otherInstituteId = otherInstitute.id;

      const password = "correctHorse1Battery";
      const instructorEmail = `certs-instructor-${RUN_ID}@example.com`;
      const studentAEmail = `certs-student-a-${RUN_ID}@example.com`;
      const studentBEmail = `certs-student-b-${RUN_ID}@example.com`;
      const outsiderInstructorEmail = `certs-outsider-instructor-${RUN_ID}@example.com`;

      const { data: instructorUser, error: instructorError } = await admin.auth.admin.createUser({
        email: instructorEmail,
        password,
        email_confirm: true,
      });
      if (instructorError || !instructorUser.user) throw new Error(`fixture instructor failed: ${instructorError?.message}`);
      instructorId = instructorUser.user.id;

      const { data: studentAUser, error: studentAError } = await admin.auth.admin.createUser({
        email: studentAEmail,
        password,
        email_confirm: true,
      });
      if (studentAError || !studentAUser.user) throw new Error(`fixture student A failed: ${studentAError?.message}`);
      studentAId = studentAUser.user.id;

      const { data: studentBUser, error: studentBError } = await admin.auth.admin.createUser({
        email: studentBEmail,
        password,
        email_confirm: true,
      });
      if (studentBError || !studentBUser.user) throw new Error(`fixture student B failed: ${studentBError?.message}`);
      studentBId = studentBUser.user.id;

      const { data: outsiderInstructorUser, error: outsiderInstructorError } = await admin.auth.admin.createUser({
        email: outsiderInstructorEmail,
        password,
        email_confirm: true,
      });
      if (outsiderInstructorError || !outsiderInstructorUser.user) throw new Error(`fixture outsider instructor failed: ${outsiderInstructorError?.message}`);
      outsiderInstructorId = outsiderInstructorUser.user.id;

      const { error: profilesError } = await admin.from("profiles").insert([
        { id: instructorId, institute_id: instituteId, role: "instructor", full_name: "Certs Instructor" },
        { id: studentAId, institute_id: instituteId, role: "student", full_name: "Student A" },
        { id: studentBId, institute_id: instituteId, role: "student", full_name: "Student B" },
        { id: outsiderInstructorId, institute_id: otherInstituteId, role: "instructor", full_name: "Outsider Instructor" },
      ]);
      if (profilesError) throw new Error(`fixture profiles failed: ${profilesError.message}`);

      const { data: course, error: courseError } = await admin
        .from("courses")
        .insert({
          institute_id: instituteId,
          created_by: instructorId,
          title: "Certified Course",
          status: "published",
        })
        .select("id")
        .single();
      if (courseError || !course) throw new Error(`fixture course failed: ${courseError?.message}`);
      courseId = course.id;

      const { data: certificateA, error: certificateAError } = await admin
        .from("certificates")
        .insert({ institute_id: instituteId, course_id: courseId, student_id: studentAId })
        .select("id")
        .single();
      if (certificateAError || !certificateA) throw new Error(`fixture certificate failed: ${certificateAError?.message}`);
      certificateAId = certificateA.id;

      studentAClient = await signIn(studentAEmail, password);
      studentBClient = await signIn(studentBEmail, password);
      instructorClient = await signIn(instructorEmail, password);
      outsiderInstructorClient = await signIn(outsiderInstructorEmail, password);
    }, 30_000);

    afterAll(async () => {
      if (!instituteId) return;
      const warn = (label: string, error: { message: string } | null) => {
        if (error) console.warn(`cleanup: ${label} failed: ${error.message}`);
      };
      warn("certificates", (await admin.from("certificates").delete().eq("institute_id", instituteId)).error);
      warn("courses", (await admin.from("courses").delete().eq("institute_id", instituteId)).error);

      const { data: profiles } = await admin
        .from("profiles")
        .select("id")
        .in("institute_id", [instituteId, otherInstituteId]);
      for (const profile of profiles ?? []) {
        warn(`profile ${profile.id}`, (await admin.from("profiles").delete().eq("id", profile.id)).error);
      }
      warn("institute", (await admin.from("institutes").delete().eq("id", instituteId)).error);
      warn("other institute", (await admin.from("institutes").delete().eq("id", otherInstituteId)).error);
      for (const profile of profiles ?? []) {
        warn(`auth user ${profile.id}`, (await admin.auth.admin.deleteUser(profile.id)).error);
      }
    });

    it("a student can read their own certificate", async () => {
      const { data, error } = await studentAClient
        .from("certificates")
        .select("id")
        .eq("id", certificateAId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("a student cannot read another student's certificate", async () => {
      const { data, error } = await studentBClient
        .from("certificates")
        .select("id")
        .eq("id", certificateAId);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });

    it("institute staff can read any certificate in their institute", async () => {
      const { data, error } = await instructorClient
        .from("certificates")
        .select("id")
        .eq("id", certificateAId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("staff from another institute cannot read this certificate", async () => {
      const { data, error } = await outsiderInstructorClient
        .from("certificates")
        .select("id")
        .eq("id", certificateAId);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });

    it("no authenticated role can insert a certificate directly — only the service-role completion path can", async () => {
      const { data, error } = await studentBClient
        .from("certificates")
        .insert({ institute_id: instituteId, course_id: courseId, student_id: studentBId })
        .select("id");
      // Same INSERT-vs-UPDATE/DELETE RLS semantics as payments.test.ts: a
      // failing WITH CHECK (here, no insert policy at all) is a hard
      // Postgres error, not a silent 0-row result.
      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(data ?? []).toHaveLength(0);

      const { data: stillNone } = await admin
        .from("certificates")
        .select("id")
        .eq("course_id", courseId)
        .eq("student_id", studentBId);
      expect(stillNone).toHaveLength(0);
    });

    it("an instructor cannot insert a certificate on a student's behalf either", async () => {
      const { data, error } = await instructorClient
        .from("certificates")
        .insert({ institute_id: instituteId, course_id: courseId, student_id: studentBId })
        .select("id");
      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(data ?? []).toHaveLength(0);
    });
  },
);
