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
 * No real Razorpay account exists (.env.local has no RAZORPAY_* vars) —
 * same "dormant until configured" treatment Stage 2 gave Bunny Stream.
 * This verifies the UI/route behave correctly in that dormant state
 * (price display, the "not configured" message, the free-course flow
 * staying untouched, and the webhook refusing to run unconfigured) —
 * not an actual payment, which is genuinely untestable without real
 * test-mode keys.
 */
test.describe("Stage 6: paid enrollment (dormant — no Razorpay account configured)", () => {
  test.skip(
    !CREDENTIALS_AVAILABLE,
    "Requires a real SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  test.describe.configure({ retries: 2 });

  let admin: SupabaseClient;
  let instituteId: string;
  let baseUrl: string;
  let freeCourseId: string;
  let paidCourseId: string;
  const runId = Date.now().toString(36);
  const ownerEmail = `e2e-stage6-owner-${runId}@example.com`;
  const studentEmail = `e2e-stage6-student-${runId}@example.com`;
  const password = "correctHorse1Battery";

  test.beforeAll(async () => {
    if (!CREDENTIALS_AVAILABLE) return;

    admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const subdomain = `e2e-stage6-${runId}`;
    const { data: institute, error: instituteError } = await admin
      .from("institutes")
      .insert({ name: "E2E Stage 6 Institute", subdomain })
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

    const { data: courses, error: coursesError } = await admin
      .from("courses")
      .insert([
        {
          institute_id: instituteId,
          created_by: ownerUser.user.id,
          title: "Free Stage 6 Course",
          status: "published",
        },
      ])
      .select("id");
    if (coursesError || !courses) throw new Error(`fixture course failed: ${coursesError?.message}`);
    freeCourseId = courses[0]!.id as string;
  });

  test.afterAll(async () => {
    if (!CREDENTIALS_AVAILABLE || !instituteId) return;
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

  test("course pricing UI, dormant checkout message, free-course flow unaffected, webhook refuses unconfigured", async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(`${baseUrl}/sign-in`);
    await ownerPage.getByLabel("Email").fill(ownerEmail);
    await ownerPage.getByLabel("Password").fill(password);
    await ownerPage.getByRole("button", { name: "Sign in" }).click();
    await ownerPage.waitForURL(`${baseUrl}/admin`);

    // --- Create a priced course via the UI ---
    await ownerPage.goto(`${baseUrl}/admin/courses`);
    await ownerPage.getByLabel("Title").fill("Paid Stage 6 Course");
    await ownerPage.getByLabel("Price (₹, optional)").fill("499");
    await ownerPage.getByRole("button", { name: "Create course" }).click();
    await ownerPage.waitForURL(/\/admin\/courses\/[0-9a-f-]+$/);
    paidCourseId = ownerPage.url().split("/").pop()!;
    await ownerPage.reload();
    await ownerPage.getByRole("button", { name: "Publish" }).click();
    await expect(ownerPage.getByText("published", { exact: true })).toBeVisible();

    await ownerContext.close();

    // --- Webhook refuses to run unconfigured ---
    const anonContext = await browser.newContext();
    const webhookResponse = await anonContext.request.post(
      `${baseUrl}/api/webhooks/razorpay`,
      { data: { event: "payment.captured" } },
    );
    expect(webhookResponse.status()).toBe(500);
    await anonContext.close();

    // --- Student: course list shows correct price labels ---
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await studentPage.goto(`${baseUrl}/sign-in`);
    await studentPage.getByLabel("Email").fill(studentEmail);
    await studentPage.getByLabel("Password").fill(password);
    await studentPage.getByRole("button", { name: "Sign in" }).click();
    await studentPage.waitForURL(`${baseUrl}/student`);

    await studentPage.goto(`${baseUrl}/student/courses`);
    await expect(studentPage.getByText("₹499")).toBeVisible();
    await expect(studentPage.getByText("Free", { exact: true })).toBeVisible();

    // --- Priced course: dormant "not configured" message, no checkout button ---
    await studentPage.goto(`${baseUrl}/student/courses/${paidCourseId}`);
    await expect(
      studentPage.getByText("Payments aren't configured for this institute yet."),
    ).toBeVisible();
    await expect(studentPage.getByRole("button", { name: /^Buy for/ })).toHaveCount(0);

    // --- Free course: self-enroll flow works exactly as before Stage 6 ---
    await studentPage.goto(`${baseUrl}/student/courses/${freeCourseId}`);
    await studentPage.getByRole("button", { name: "Enroll in this course" }).click();
    // Same lesson as Stage 4's unenroll flows: refresh() re-renders the
    // whole page past the transient success message before it can be
    // reliably caught — the resulting enrolled-state UI is the real
    // success signal here, not the message.
    await expect(studentPage.getByRole("button", { name: "Unenroll" })).toBeVisible({
      timeout: 10_000,
    });

    await studentContext.close();
  });
});
