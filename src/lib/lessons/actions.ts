"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { requireTenantRole, type SessionProfile } from "@/lib/auth/guard";
import { logAudit } from "@/lib/audit/log";
import { canManage } from "@/lib/courses/ownership";
import { formField, formFields } from "@/lib/form-data";
import { getClientIp } from "@/lib/request-ip";
import { createServerClient } from "@/lib/supabase/server";
import {
  createLessonSchema,
  lessonIdSchema,
  reorderLessonsSchema,
  setLessonStatusSchema,
  updateLessonSchema,
} from "@/lib/validation/courses";

export type LessonActionState = { error: string } | { success: string } | undefined;

const NOT_ALLOWED = "You can only manage lessons in courses you created.";

/**
 * Lessons have no created_by of their own: write access follows the parent
 * course's creator (0012's lessons_insert/lessons_update). All writes go
 * through the session client so that RLS is the enforcing boundary.
 */

type Supabase = Awaited<ReturnType<typeof createServerClient>>;

async function loadManageableCourse(
  supabase: Supabase,
  actor: SessionProfile,
  courseId: string,
) {
  const { data: course } = await supabase
    .from("courses")
    .select("id, created_by")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return { ok: false, error: "Course not found." } as const;
  if (!canManage(actor, course.created_by))
    return { ok: false, error: NOT_ALLOWED } as const;
  return { ok: true, course } as const;
}

async function loadManageableLesson(
  supabase: Supabase,
  actor: SessionProfile,
  lessonId: string,
) {
  const { data: lesson } = await supabase
    .from("lessons")
    .select("id, course_id, courses(created_by)")
    .eq("id", lessonId)
    .maybeSingle();
  if (!lesson) return { ok: false, error: "Lesson not found." } as const;
  const parent = lesson.courses as unknown as { created_by: string | null } | null;
  if (!canManage(actor, parent?.created_by ?? null))
    return { ok: false, error: NOT_ALLOWED } as const;
  return {
    ok: true,
    lesson: { id: lesson.id as string, courseId: lesson.course_id as string },
  } as const;
}

export async function createLesson(
  _prevState: LessonActionState,
  formData: FormData,
): Promise<LessonActionState> {
  const actor = await requireTenantRole(["institute_owner", "instructor"]);

  const parsed = createLessonSchema.safeParse({
    courseId: formField(formData, "courseId"),
    title: formField(formData, "title"),
    content: formField(formData, "content"),
    videoId: formField(formData, "videoId"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  if (!actor.instituteId) return { error: "Could not create lesson." };

  const supabase = await createServerClient();
  const loaded = await loadManageableCourse(supabase, actor, parsed.data.courseId);
  if (!loaded.ok) return { error: loaded.error };

  const { data: last } = await supabase
    .from("lessons")
    .select("position")
    .eq("course_id", parsed.data.courseId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("lessons")
    .insert({
      institute_id: actor.instituteId,
      course_id: parsed.data.courseId,
      position: (last?.position ?? -1) + 1,
      title: parsed.data.title,
      content_format: "markdown",
      content: parsed.data.content ?? null,
      video_provider: parsed.data.videoId ? "bunny" : null,
      video_id: parsed.data.videoId ?? null,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "Could not create lesson." };

  await logAudit({
    instituteId: actor.instituteId,
    actorId: actor.id,
    action: "lesson.created",
    target: data.id,
    metadata: { courseId: parsed.data.courseId, title: parsed.data.title },
    ip: await getClientIp(),
  });

  // See courses/actions.ts createCourse for why refresh() must precede a
  // redirect into a page the client router hasn't cached yet.
  refresh();
  redirect(`/admin/courses/${parsed.data.courseId}/lessons/${data.id}`);
}

export async function updateLesson(
  _prevState: LessonActionState,
  formData: FormData,
): Promise<LessonActionState> {
  const actor = await requireTenantRole(["institute_owner", "instructor"]);

  const parsed = updateLessonSchema.safeParse({
    lessonId: formField(formData, "lessonId"),
    title: formField(formData, "title"),
    content: formField(formData, "content"),
    videoId: formField(formData, "videoId"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createServerClient();
  const loaded = await loadManageableLesson(supabase, actor, parsed.data.lessonId);
  if (!loaded.ok) return { error: loaded.error };

  const { data, error } = await supabase
    .from("lessons")
    .update({
      title: parsed.data.title,
      content: parsed.data.content ?? null,
      video_provider: parsed.data.videoId ? "bunny" : null,
      video_id: parsed.data.videoId ?? null,
    })
    .eq("id", parsed.data.lessonId)
    .select("id")
    .maybeSingle();

  if (error || !data) return { error: "Could not update lesson." };

  await logAudit({
    instituteId: actor.instituteId,
    actorId: actor.id,
    action: "lesson.updated",
    target: data.id,
    metadata: { courseId: loaded.lesson.courseId, title: parsed.data.title },
    ip: await getClientIp(),
  });

  refresh();
  return { success: "Lesson saved." };
}

/**
 * Rewrites positions for a course's lessons in the submitted order. Every
 * submitted ID must belong to this course (and therefore, via RLS, this
 * institute) before any position is written.
 */
export async function reorderLessons(
  _prevState: LessonActionState,
  formData: FormData,
): Promise<LessonActionState> {
  const actor = await requireTenantRole(["institute_owner", "instructor"]);

  const parsed = reorderLessonsSchema.safeParse({
    courseId: formField(formData, "courseId"),
    lessonIds: formFields(formData, "lessonIds"),
  });
  if (!parsed.success) return { error: "Invalid request." };

  const supabase = await createServerClient();
  const loaded = await loadManageableCourse(supabase, actor, parsed.data.courseId);
  if (!loaded.ok) return { error: loaded.error };

  const { data: lessons, error: loadError } = await supabase
    .from("lessons")
    .select("id")
    .eq("course_id", parsed.data.courseId)
    .in("id", parsed.data.lessonIds);

  if (loadError || !lessons || lessons.length !== parsed.data.lessonIds.length) {
    return { error: "Every lesson must belong to this course." };
  }

  for (const [position, lessonId] of parsed.data.lessonIds.entries()) {
    const { error } = await supabase
      .from("lessons")
      .update({ position })
      .eq("id", lessonId)
      .eq("course_id", parsed.data.courseId);
    if (error) return { error: "Could not reorder lessons." };
  }

  await logAudit({
    instituteId: actor.instituteId,
    actorId: actor.id,
    action: "lesson.reordered",
    target: parsed.data.courseId,
    metadata: { lessonIds: parsed.data.lessonIds },
    ip: await getClientIp(),
  });

  refresh();
  return { success: "Lessons reordered." };
}

export async function setLessonStatus(
  _prevState: LessonActionState,
  formData: FormData,
): Promise<LessonActionState> {
  const actor = await requireTenantRole(["institute_owner", "instructor"]);

  const parsed = setLessonStatusSchema.safeParse({
    lessonId: formField(formData, "lessonId"),
    status: formField(formData, "status"),
  });
  if (!parsed.success) return { error: "Invalid request." };

  const supabase = await createServerClient();
  const loaded = await loadManageableLesson(supabase, actor, parsed.data.lessonId);
  if (!loaded.ok) return { error: loaded.error };

  const { data, error } = await supabase
    .from("lessons")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.lessonId)
    .select("id")
    .maybeSingle();

  if (error || !data) return { error: "Could not update lesson status." };

  await logAudit({
    instituteId: actor.instituteId,
    actorId: actor.id,
    action:
      parsed.data.status === "published" ? "lesson.published" : "lesson.unpublished",
    target: data.id,
    metadata: { courseId: loaded.lesson.courseId },
    ip: await getClientIp(),
  });

  refresh();
  return { success: `Lesson is now ${parsed.data.status}.` };
}

export async function archiveLesson(
  _prevState: LessonActionState,
  formData: FormData,
): Promise<LessonActionState> {
  const actor = await requireTenantRole(["institute_owner", "instructor"]);

  const parsed = lessonIdSchema.safeParse({ lessonId: formField(formData, "lessonId") });
  if (!parsed.success) return { error: "Invalid request." };

  const supabase = await createServerClient();
  const loaded = await loadManageableLesson(supabase, actor, parsed.data.lessonId);
  if (!loaded.ok) return { error: loaded.error };

  const { data, error } = await supabase
    .from("lessons")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", parsed.data.lessonId)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();

  if (error) return { error: "Could not archive lesson." };
  if (!data) return { error: "Lesson is already archived." };

  await logAudit({
    instituteId: actor.instituteId,
    actorId: actor.id,
    action: "lesson.archived",
    target: data.id,
    metadata: { courseId: loaded.lesson.courseId },
    ip: await getClientIp(),
  });

  refresh();
  return { success: "Lesson archived." };
}
