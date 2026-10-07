import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value === "" ? undefined : value));

export const contentStatusSchema = z.enum(["draft", "published"]);

export const createCourseSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200),
  description: optionalText(5_000),
});

export const updateCourseSchema = createCourseSchema.extend({
  courseId: z.string().uuid(),
});

export const setCourseStatusSchema = z.object({
  courseId: z.string().uuid(),
  status: contentStatusSchema,
});

export const courseIdSchema = z.object({
  courseId: z.string().uuid(),
});

const lessonFields = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200),
  // Markdown, rendered via react-markdown without raw HTML (SECURITY.md §5).
  content: z
    .string()
    .max(50_000, "Lesson content is too long (50,000 characters max).")
    .optional()
    .transform((value) => (value && value.trim() !== "" ? value : undefined)),
  videoId: z
    .string()
    .trim()
    .max(100)
    .regex(/^[A-Za-z0-9-]*$/, "Video ID may only contain letters, digits and hyphens.")
    .optional()
    .transform((value) => (value ? value : undefined)),
});

const requireContentOrVideo = <T extends { content?: string; videoId?: string }>(
  value: T,
) => Boolean(value.content || value.videoId);

const contentOrVideoMessage = {
  message: "Add lesson text, a video ID, or both.",
  path: ["content"],
};

export const createLessonSchema = lessonFields
  .extend({ courseId: z.string().uuid() })
  .refine(requireContentOrVideo, contentOrVideoMessage);

export const updateLessonSchema = lessonFields
  .extend({ lessonId: z.string().uuid() })
  .refine(requireContentOrVideo, contentOrVideoMessage);

export const setLessonStatusSchema = z.object({
  lessonId: z.string().uuid(),
  status: contentStatusSchema,
});

export const lessonIdSchema = z.object({
  lessonId: z.string().uuid(),
});

export const reorderLessonsSchema = z.object({
  courseId: z.string().uuid(),
  lessonIds: z
    .array(z.string().uuid())
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, "Duplicate lesson IDs."),
});
