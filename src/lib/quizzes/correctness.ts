/**
 * Pure grading-correctness logic — no `server-only`/env dependency, so
 * it's directly unit-testable (tests/unit/correctness.test.ts). Split out
 * of grading.ts (which stays `server-only` for its DB-touching functions)
 * so this part can be exercised without pulling that guard in — the same
 * reasoning as src/lib/csv.ts and src/lib/quizzes/csv-import.ts.
 */

/** Exact-set-match: true only when both sets contain exactly the same values. */
export function sameSet(a: string[], b: string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const value of setA) {
    if (!setB.has(value)) return false;
  }
  return true;
}

/** Case-insensitive, whitespace-trimmed comparison for short_answer grading. */
export function normalizeTextAnswer(value: string): string {
  return value.trim().toLowerCase();
}

export type AnswerKeyRow = {
  correctOptionIds: string[] | null;
  correctTextAnswers: string[] | null;
};

export type SubmittedAnswer = {
  selectedOptionIds: string[];
  textAnswer: string | null;
};

/**
 * True when a single question is correctly answered: exact-set-match for
 * choice questions, case/whitespace-insensitive membership for
 * short_answer.
 */
export function isQuestionCorrect(
  questionType: string,
  key: AnswerKeyRow,
  submitted: SubmittedAnswer | undefined,
): boolean {
  if (!submitted) return false;
  if (questionType === "short_answer") {
    if (!key.correctTextAnswers || !submitted.textAnswer) return false;
    const normalized = normalizeTextAnswer(submitted.textAnswer);
    return key.correctTextAnswers.some((accepted) => normalizeTextAnswer(accepted) === normalized);
  }
  if (!key.correctOptionIds || key.correctOptionIds.length === 0) return false;
  return sameSet(submitted.selectedOptionIds, key.correctOptionIds);
}
