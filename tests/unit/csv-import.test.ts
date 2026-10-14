import { describe, expect, it } from "vitest";

import { parseQuestionsCsv } from "@/lib/quizzes/csv-import";

const HEADER = "question_text,points,option_1,option_2,option_3,correct_options";

describe("parseQuestionsCsv", () => {
  it("parses a valid single-choice and multiple-choice row", () => {
    const csv = `${HEADER}\n"2 + 2?",1,3,4,,2\n"Primes?",2,2,3,4,1;2`;
    const result = parseQuestionsCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.questions).toHaveLength(2);

    expect(result.questions[0]).toEqual({
      questionText: "2 + 2?",
      points: 1,
      options: [
        { text: "3", correct: false },
        { text: "4", correct: true },
      ],
    });
    expect(result.questions[1]!.options.filter((o) => o.correct)).toHaveLength(2);
  });

  it("defaults blank points to 1", () => {
    const csv = `${HEADER}\n"Q?",,1,2,,1`;
    const result = parseQuestionsCsv(csv);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.questions[0]!.points).toBe(1);
  });

  it("rejects an empty CSV", () => {
    expect(parseQuestionsCsv("")).toEqual({ ok: false, errors: ["The CSV is empty."] });
  });

  it("rejects a malformed header", () => {
    const result = parseQuestionsCsv("foo,bar\n1,2");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/question_text/);
  });

  it("rejects a non-contiguous option column name", () => {
    const result = parseQuestionsCsv(
      "question_text,points,option_1,option_3,correct_options\nQ,1,a,b,1",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/option_2/);
  });

  it("rejects a row with the wrong column count", () => {
    const result = parseQuestionsCsv(`${HEADER}\nQ,1,a,b`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/Line 2.*columns/);
  });

  it("rejects correct_options pointing at an empty/missing option", () => {
    const result = parseQuestionsCsv(`${HEADER}\nQ,1,a,b,,3`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/Line 2.*option 3/);
  });

  it("rejects fewer than 2 non-empty options", () => {
    const result = parseQuestionsCsv(`${HEADER}\nQ,1,a,,,1`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/at least 2/);
  });

  it("collects errors from every bad row, not just the first", () => {
    const csv = `${HEADER}\nQ1,1,a,,,1\nQ2,1,b,,,1`;
    const result = parseQuestionsCsv(csv);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toMatch(/Line 2/);
      expect(result.errors[1]).toMatch(/Line 3/);
    }
  });

  it("strips a CSV-injection formula prefix from question and option text", () => {
    const csv = `${HEADER}\n"=cmd|'/c calc'!A1",1,+1,-1,@1,1`;
    const result = parseQuestionsCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.questions[0]!.questionText.startsWith("'=")).toBe(true);
    expect(result.questions[0]!.options[0]!.text.startsWith("'+")).toBe(true);
  });

  it("rejects more than 500 data rows", () => {
    const rows = Array.from({ length: 501 }, (_, i) => `Q${i},1,a,b,,1`).join("\n");
    const result = parseQuestionsCsv(`${HEADER}\n${rows}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/Too many rows/);
  });
});
