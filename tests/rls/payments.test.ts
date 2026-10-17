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
const PRICE_PAISE = 50_000; // ₹500

describe.skipIf(!CREDENTIALS_AVAILABLE)(
  "RLS: paid enrollment (Stage 6, 0026_payments.sql)",
  () => {
    let admin: SupabaseClient;
    let instituteId: string;
    let instructorId: string;
    let studentAId: string;
    let studentBId: string;
    let studentAClient: SupabaseClient;
    let studentBClient: SupabaseClient;
    let freeCourseId: string;
    let paidCourseId: string;

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

      const subdomain = `payments-${RUN_ID}`;
      const { data: institute, error: instituteError } = await admin
        .from("institutes")
        .insert({ name: "Payments Test", subdomain })
        .select("id")
        .single();
      if (instituteError || !institute) throw new Error(`fixture institute failed: ${instituteError?.message}`);
      instituteId = institute.id;

      const password = "correctHorse1Battery";
      const instructorEmail = `payments-instructor-${RUN_ID}@example.com`;
      const studentAEmail = `payments-student-a-${RUN_ID}@example.com`;
      const studentBEmail = `payments-student-b-${RUN_ID}@example.com`;

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

      const { error: profilesError } = await admin.from("profiles").insert([
        { id: instructorId, institute_id: instituteId, role: "instructor", full_name: "Payments Instructor" },
        { id: studentAId, institute_id: instituteId, role: "student", full_name: "Student A" },
        { id: studentBId, institute_id: instituteId, role: "student", full_name: "Student B" },
      ]);
      if (profilesError) throw new Error(`fixture profiles failed: ${profilesError.message}`);

      const { data: courses, error: coursesError } = await admin
        .from("courses")
        .insert([
          {
            institute_id: instituteId,
            created_by: instructorId,
            title: "Free Course",
            status: "published",
          },
          {
            institute_id: instituteId,
            created_by: instructorId,
            title: "Paid Course",
            status: "published",
            price_paise: PRICE_PAISE,
          },
        ])
        .select("id, title");
      if (coursesError || !courses) throw new Error(`fixture courses failed: ${coursesError?.message}`);
      freeCourseId = courses.find((c) => c.title === "Free Course")!.id as string;
      paidCourseId = courses.find((c) => c.title === "Paid Course")!.id as string;

      studentAClient = await signIn(studentAEmail, password);
      studentBClient = await signIn(studentBEmail, password);
    }, 30_000);

    afterAll(async () => {
      if (!instituteId) return;
      const warn = (label: string, error: { message: string } | null) => {
        if (error) console.warn(`cleanup: ${label} failed: ${error.message}`);
      };
      warn("payments", (await admin.from("payments").delete().eq("institute_id", instituteId)).error);
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

    it("a student can still self-enroll directly in a free course (regression)", async () => {
      const { data, error } = await studentAClient
        .from("enrollments")
        .insert({ institute_id: instituteId, course_id: freeCourseId, student_id: studentAId })
        .select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("a student cannot self-insert an enrollment for a priced course", async () => {
      const { data, error } = await studentAClient
        .from("enrollments")
        .insert({ institute_id: instituteId, course_id: paidCourseId, student_id: studentAId })
        .select("id");
      // Unlike UPDATE/DELETE (which silently filter to 0 rows), a failing
      // WITH CHECK on INSERT is a hard Postgres error (42501) — the row
      // gets constructed and then rejected at check time.
      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(data ?? []).toHaveLength(0);

      const { data: stillNone } = await admin
        .from("enrollments")
        .select("id")
        .eq("course_id", paidCourseId)
        .eq("student_id", studentAId);
      expect(stillNone).toHaveLength(0);
    });

    it("a student can create a payments row with the correct amount/currency for a priced course", async () => {
      const { data, error } = await studentBClient
        .from("payments")
        .insert({
          institute_id: instituteId,
          course_id: paidCourseId,
          student_id: studentBId,
          razorpay_order_id: `order_correct_${RUN_ID}`,
          amount_paise: PRICE_PAISE,
          currency: "INR",
        })
        .select("id, status");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0]!.status).toBe("created");
    });

    it("rejects a payments row with a forged (wrong) amount", async () => {
      const { data, error } = await studentBClient
        .from("payments")
        .insert({
          institute_id: instituteId,
          course_id: paidCourseId,
          student_id: studentBId,
          razorpay_order_id: `order_forged_amount_${RUN_ID}`,
          amount_paise: 1, // not the course's real price
          currency: "INR",
        })
        .select("id");
      expect(error).not.toBeNull();
      expect(data ?? []).toHaveLength(0);
    });

    it("rejects a payments row inserted as already-captured, bypassing the webhook", async () => {
      const { data, error } = await studentBClient
        .from("payments")
        .insert({
          institute_id: instituteId,
          course_id: paidCourseId,
          student_id: studentBId,
          razorpay_order_id: `order_forged_status_${RUN_ID}`,
          amount_paise: PRICE_PAISE,
          currency: "INR",
          status: "captured",
        })
        .select("id");
      expect(error).not.toBeNull();
      expect(data ?? []).toHaveLength(0);
    });

    it("no authenticated role can update a payments row's status — only the service-role webhook can", async () => {
      const { data: created, error: insertError } = await admin
        .from("payments")
        .insert({
          institute_id: instituteId,
          course_id: paidCourseId,
          student_id: studentBId,
          razorpay_order_id: `order_immutable_${RUN_ID}`,
          amount_paise: PRICE_PAISE,
          currency: "INR",
        })
        .select("id")
        .single();
      expect(insertError).toBeNull();

      const { data: updated, error: updateError } = await studentBClient
        .from("payments")
        .update({ status: "captured" })
        .eq("id", created!.id)
        .select("id");
      expect(updateError).toBeNull();
      expect(updated ?? []).toHaveLength(0);

      const { data: unchanged } = await admin
        .from("payments")
        .select("status")
        .eq("id", created!.id)
        .single();
      expect(unchanged?.status).toBe("created");
    });
  },
);
