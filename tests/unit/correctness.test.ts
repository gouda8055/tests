import { describe, expect, it } from "vitest";

import {
  isQuestionCorrect,
  normalizeTextAnswer,
  sameSet,
} from "@/lib/quizzes/correctness";

describe("sameSet", () => {
  it("is true for identical sets regardless of order", () => {
    expect(sameSet(["a", "b"], ["b", "a"])).toBe(true);
  });

  it("is false when sizes differ", () => {
    expect(sameSet(["a"], ["a", "b"])).toBe(false);
  });

  it("is false when contents differ", () => {
    expect(sameSet(["a", "b"], ["a", "c"])).toBe(false);
  });
});

describe("normalizeTextAnswer", () => {
  it("trims and lowercases", () => {
    expect(normalizeTextAnswer("  Paris  ")).toBe("paris");
  });
});

describe("isQuestionCorrect", () => {
  it("grades a single_choice question via exact-set-match", () => {
    const key = { correctOptionIds: ["opt-1"], correctTextAnswers: null };
    expect(
      isQuestionCorrect("single_choice", key, {
        selectedOptionIds: ["opt-1"],
        textAnswer: null,
      }),
    ).toBe(true);
    expect(
      isQuestionCorrect("single_choice", key, {
        selectedOptionIds: ["opt-2"],
        textAnswer: null,
      }),
    ).toBe(false);
  });

  it("grades multiple_choice requiring the exact set, not a subset", () => {
    const key = { correctOptionIds: ["opt-1", "opt-2"], correctTextAnswers: null };
    expect(
      isQuestionCorrect("multiple_choice", key, {
        selectedOptionIds: ["opt-1"],
        textAnswer: null,
      }),
    ).toBe(false);
    expect(
      isQuestionCorrect("multiple_choice", key, {
        selectedOptionIds: ["opt-2", "opt-1"],
        textAnswer: null,
      }),
    ).toBe(true);
  });

  it("grades short_answer case- and whitespace-insensitively", () => {
    const key = { correctOptionIds: null, correctTextAnswers: ["Paris", "Lutetia"] };
    expect(
      isQuestionCorrect("short_answer", key, {
        selectedOptionIds: [],
        textAnswer: "  PARIS  ",
      }),
    ).toBe(true);
    expect(
      isQuestionCorrect("short_answer", key, {
        selectedOptionIds: [],
        textAnswer: "lutetia",
      }),
    ).toBe(true);
    expect(
      isQuestionCorrect("short_answer", key, {
        selectedOptionIds: [],
        textAnswer: "London",
      }),
    ).toBe(false);
  });

  it("is false for a short_answer question with no submitted text", () => {
    const key = { correctOptionIds: null, correctTextAnswers: ["Paris"] };
    expect(
      isQuestionCorrect("short_answer", key, { selectedOptionIds: [], textAnswer: null }),
    ).toBe(false);
    expect(isQuestionCorrect("short_answer", key, undefined)).toBe(false);
  });

  it("is false when the answer key itself has no correct answers of the right shape", () => {
    expect(
      isQuestionCorrect(
        "single_choice",
        { correctOptionIds: [], correctTextAnswers: null },
        { selectedOptionIds: [], textAnswer: null },
      ),
    ).toBe(false);
    expect(
      isQuestionCorrect(
        "short_answer",
        { correctOptionIds: null, correctTextAnswers: null },
        { selectedOptionIds: [], textAnswer: "anything" },
      ),
    ).toBe(false);
  });
});
