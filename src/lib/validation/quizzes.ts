import { z } from "zod";

import { contentStatusSchema } from "@/lib/validation/courses";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value === "" ? undefined : value));

const quizFields = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200),
  description: optionalText(5_000),
  // "none" is the Select sentinel for "not attached to a lesson" (Radix
  // Select items cannot carry an empty-string value).
  lessonId: z
    .union([z.string().uuid(), z.literal("none"), z.literal("")])
    .optional()
    .transform((value) => (value && value !== "none" ? value : undefined)),
  durationMinutes: z.coerce
    .number({ error: "Enter a duration in minutes." })
    .int("Duration must be a whole number of minutes.")
    .min(1, "Duration must be at least 1 minute.")
    .max(600, "Duration can be at most 600 minutes."),
  graceSeconds: z.coerce
    .number({ error: "Enter a grace period in seconds." })
    .int()
    .min(0, "Grace period can't be negative.")
    .max(600, "Grace period can be at most 600 seconds."),
  maxAttempts: z.coerce
    .number({ error: "Enter the number of attempts allowed." })
    .int()
    .min(1, "Allow at least 1 attempt.")
    .max(100, "At most 100 attempts."),
  randomizeQuestions: z.boolean(),
  randomizeOptions: z.boolean(),
  showAnswersAfterSubmit: z.boolean(),
});

export const createQuizSchema = quizFields.extend({ courseId: z.string().uuid() });

export const updateQuizSchema = quizFields.extend({ quizId: z.string().uuid() });

export const setQuizStatusSchema = z.object({
  quizId: z.string().uuid(),
  status: contentStatusSchema,
});

export const quizIdSchema = z.object({ quizId: z.string().uuid() });

export const questionTypeSchema = z.enum(["single_choice", "multiple_choice"]);

export const optionTextSchema = z
  .string()
  .trim()
  .min(1, "Option text can't be empty.")
  .max(1_000, "Option text is too long (1,000 characters max).");

export const questionTextSchema = z
  .string()
  .trim()
  .min(1, "Question text is required.")
  .max(10_000, "Question text is too long (10,000 characters max).");

export const pointsSchema = z.coerce
  .number({ error: "Enter the points for this question." })
  .positive("Points must be greater than 0.")
  .max(1_000);

const questionFields = z.object({
  questionText: questionTextSchema,
  questionType: questionTypeSchema,
  points: pointsSchema,
  explanation: optionalText(10_000),
});

export function checkCorrectCount(
  questionType: z.infer<typeof questionTypeSchema>,
  options: { correct: boolean }[],
  ctx: z.RefinementCtx,
) {
  const total = options.length;
  const correct = options.filter((option) => option.correct).length;

  if (total < 2) {
    ctx.addIssue({
      code: "custom",
      message: "Add at least 2 options.",
      path: ["options"],
    });
  }
  if (total > 10) {
    ctx.addIssue({ code: "custom", message: "At most 10 options.", path: ["options"] });
  }
  if (questionType === "single_choice" && correct !== 1) {
    ctx.addIssue({
      code: "custom",
      message: "Mark exactly one correct option for a single-choice question.",
      path: ["options"],
    });
  }
  if (questionType === "multiple_choice" && correct < 1) {
    ctx.addIssue({
      code: "custom",
      message: "Mark at least one correct option.",
      path: ["options"],
    });
  }
}

export const createQuestionSchema = questionFields
  .extend({
    quizId: z.string().uuid(),
    options: z.array(z.object({ text: optionTextSchema, correct: z.boolean() })),
  })
  .superRefine((value, ctx) => checkCorrectCount(value.questionType, value.options, ctx));

export const updateQuestionSchema = questionFields
  .extend({
    questionId: z.string().uuid(),
    existingOptions: z.array(
      z.object({ id: z.string().uuid(), text: optionTextSchema, correct: z.boolean() }),
    ),
    newOptions: z.array(z.object({ text: optionTextSchema, correct: z.boolean() })),
  })
  .superRefine((value, ctx) =>
    checkCorrectCount(
      value.questionType,
      [...value.existingOptions, ...value.newOptions],
      ctx,
    ),
  );

export const questionIdSchema = z.object({ questionId: z.string().uuid() });

export const startAttemptSchema = z.object({ quizId: z.string().uuid() });

export const saveAnswerSchema = z.object({
  attemptId: z.string().uuid(),
  questionId: z.string().uuid(),
  selectedOptionIds: z
    .array(z.string().uuid())
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length, "Duplicate option IDs."),
});

export const submitAttemptSchema = z.object({ attemptId: z.string().uuid() });

/**
 * Bulk question import (Stage 4). Validates only the envelope (quizId +
 * a size cap on the pasted text); src/lib/quizzes/csv-import.ts does the
 * per-row CSV parsing and validates each parsed row against
 * importedQuestionSchema below, reusing the exact same field constraints
 * single-question authoring uses (questionTextSchema, optionTextSchema,
 * pointsSchema, checkCorrectCount).
 */
export const importQuestionsSchema = z.object({
  quizId: z.string().uuid(),
  csvText: z
    .string()
    .min(1, "Paste some CSV text first.")
    .max(200_000, "That's too much text to import at once (200,000 characters max)."),
});

export const importedQuestionSchema = z
  .object({
    questionText: questionTextSchema,
    points: pointsSchema,
    options: z
      .array(z.object({ text: optionTextSchema, correct: z.boolean() }))
      .max(10, "At most 10 options."),
  })
  .superRefine((value, ctx) =>
    checkCorrectCount(
      value.options.filter((option) => option.correct).length === 1
        ? "single_choice"
        : "multiple_choice",
      value.options,
      ctx,
    ),
  );
