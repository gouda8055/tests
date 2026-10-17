import { describe, expect, it } from "vitest";

import { updateQuizSchema } from "@/lib/validation/quizzes";

const basePayload = {
  quizId: "11111111-1111-4111-8111-111111111111",
  title: "A Quiz",
  durationMinutes: 30,
  graceSeconds: 30,
  maxAttempts: 1,
  randomizeQuestions: true,
  randomizeOptions: true,
  showAnswersAfterSubmit: false,
};

describe("passingScorePercent", () => {
  /**
   * Regression test: Number("") === 0 in JS, and 0 passes
   * min(0).max(100) — so a blank field must not silently become a real
   * (and trivially-satisfied) 0% completion requirement. Caught live:
   * saving a quiz's settings with this field left blank set
   * passing_score_percent to 0 in the DB instead of staying null.
   */
  it("a blank field stays unset, not 0", () => {
    const result = updateQuizSchema.safeParse({ ...basePayload, passingScorePercent: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.passingScorePercent).toBeUndefined();
    }
  });

  it("an omitted field stays unset", () => {
    const result = updateQuizSchema.safeParse(basePayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.passingScorePercent).toBeUndefined();
    }
  });

  it("an explicit 0 is accepted as a real 0% passing score", () => {
    const result = updateQuizSchema.safeParse({ ...basePayload, passingScorePercent: "0" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.passingScorePercent).toBe(0);
    }
  });

  it("accepts a normal value and rejects out-of-range ones", () => {
    const ok = updateQuizSchema.safeParse({ ...basePayload, passingScorePercent: "75" });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.passingScorePercent).toBe(75);

    const tooHigh = updateQuizSchema.safeParse({ ...basePayload, passingScorePercent: "101" });
    expect(tooHigh.success).toBe(false);
  });
});
