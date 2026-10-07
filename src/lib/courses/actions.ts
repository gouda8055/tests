"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { requireTenantRole, type SessionProfile } from "@/lib/auth/guard";
import { logAudit } from "@/lib/audit/log";
import { canManage } from "@/lib/courses/ownership";
import { formField } from "@/lib/form-data";
import { getClientIp } from "@/lib/request-ip";
import { createServerClient } from "@/lib/supabase/server";
import {
  courseIdSchema,
  createCourseSchema,
  setCourseStatusSchema,
  updateCourseSchema,
} from "@/lib/validation/courses";

export type CourseActionState = { error: string } | { success: string } | undefined;

const NOT_ALLOWED = "You can only manage courses you created.";

/**
 * All writes go through the session client: the courses RLS policies
 * (0010) already allow staff to write their own institute's rows and
 * enforce creator-only edits for instructors. institute_id and created_by
 * come from the verified session, never from the form (SECURITY.md §1).
 */

export async function createCourse(
  _prevState: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  const actor = await requireTenantRole(["institute_owner", "instructor"]);

  const parsed = createCourseSchema.safeParse({
    title: formField(formData, "title"),
    description: formField(formData, "description"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  if (!actor.instituteId) return { error: "Could not create course." };

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("courses")
    .insert({
      institute_id: actor.instituteId,
      created_by: actor.id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "Could not create course." };

  await logAudit({
    instituteId: actor.instituteId,
    actorId: actor.id,
    action: "course.created",
    target: data.id,
    metadata: { title: parsed.data.title },
    ip: await getClientIp(),
  });

  // Without this, the client router has no cached entry for the brand-new
  // course page and the redirect below can leave the previous page's tree
  // mounted indefinitely (reproduced via e2e/course-quiz-flow.spec.ts) —
  // every other "create and navigate to a new page" action here needs the
  // same call, immediately before its own redirect().
  refresh();
  redirect(`/admin/courses/${data.id}`);
}

/** Loads a course through RLS and applies the creator check. */
async function loadManageableCourse(actor: SessionProfile, courseId: string) {
  const supabase = await createServerClient();
  const { data: course } = await supabase
    .from("courses")
    .select("id, created_by, title")
    .eq("id", courseId)
    .maybeSingle();

  if (!course) return { ok: false, error: "Course not found." } as const;
  if (!canManage(actor, course.created_by))
    return { ok: false, error: NOT_ALLOWED } as const;
  return { ok: true, supabase, course } as const;
}

export async function updateCourse(
  _prevState: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  const actor = await requireTenantRole(["institute_owner", "instructor"]);

  const parsed = updateCourseSchema.safeParse({
    courseId: formField(formData, "courseId"),
    title: formField(formData, "title"),
    description: formField(formData, "description"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const loaded = await loadManageableCourse(actor, parsed.data.courseId);
  if (!loaded.ok) return { error: loaded.error };
  const { supabase } = loaded;

  const { data, error } = await supabase
    .from("courses")
    .update({ title: parsed.data.title, description: parsed.data.description ?? null })
    .eq("id", parsed.data.courseId)
    .select("id")
    .maybeSingle();

  if (error || !data) return { error: "Could not update course." };

  await logAudit({
    instituteId: actor.instituteId,
    actorId: actor.id,
    action: "course.updated",
    target: data.id,
    metadata: { title: parsed.data.title },
    ip: await getClientIp(),
  });

  refresh();
  return { success: "Course saved." };
}

export async function setCourseStatus(
  _prevState: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  const actor = await requireTenantRole(["institute_owner", "instructor"]);

  const parsed = setCourseStatusSchema.safeParse({
    courseId: formField(formData, "courseId"),
    status: formField(formData, "status"),
  });
  if (!parsed.success) return { error: "Invalid request." };

  const loaded = await loadManageableCourse(actor, parsed.data.courseId);
  if (!loaded.ok) return { error: loaded.error };
  const { supabase } = loaded;

  const { data, error } = await supabase
    .from("courses")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.courseId)
    .select("id")
    .maybeSingle();

  if (error || !data) return { error: "Could not update course status." };

  await logAudit({
    instituteId: actor.instituteId,
    actorId: actor.id,
    action:
      parsed.data.status === "published" ? "course.published" : "course.unpublished",
    target: data.id,
    ip: await getClientIp(),
  });

  refresh();
  return { success: `Course is now ${parsed.data.status}.` };
}

export async function archiveCourse(
  _prevState: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  const actor = await requireTenantRole(["institute_owner", "instructor"]);

  const parsed = courseIdSchema.safeParse({ courseId: formField(formData, "courseId") });
  if (!parsed.success) return { error: "Invalid request." };

  const loaded = await loadManageableCourse(actor, parsed.data.courseId);
  if (!loaded.ok) return { error: loaded.error };
  const { supabase } = loaded;

  const { data, error } = await supabase
    .from("courses")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", parsed.data.courseId)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();

  if (error) return { error: "Could not archive course." };
  if (!data) return { error: "Course is already archived." };

  await logAudit({
    instituteId: actor.instituteId,
    actorId: actor.id,
    action: "course.archived",
    target: data.id,
    ip: await getClientIp(),
  });

  refresh();
  return { success: "Course archived." };
}
