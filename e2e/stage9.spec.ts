import { test, expect } from "@playwright/test";

/**
 * Stage 9 (production readiness, SECURITY.md §11): a baseline security
 * header set added in next.config.ts's headers() function. No fixtures
 * needed — these headers apply to every route via the `/(.*)` matcher,
 * so a single public page load is representative. (The gradebook
 * export's new audit-log entry, the other Stage 9 code change, is
 * covered by re-running e2e/stage4.spec.ts — which already exercises
 * that exact route — and checking `audit_logs` directly afterward,
 * rather than duplicating stage4's institute/course/quiz fixture here.)
 */
test.describe("Stage 9: security headers", () => {
  test("a real page load includes the baseline security header set", async ({ request }) => {
    const response = await request.get("/sign-in");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["x-frame-options"]).toBe("DENY");
    expect(response.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(response.headers()["strict-transport-security"]).toContain("max-age=63072000");
    expect(response.headers()["permissions-policy"]).toContain("camera=()");
  });
});
