"use server";

import { refresh } from "next/cache";

import { requireTenantRole } from "@/lib/auth/guard";
import { logAudit } from "@/lib/audit/log";
import { formField } from "@/lib/form-data";
import { getClientIp } from "@/lib/request-ip";
import { createServerClient } from "@/lib/supabase/server";
import { courseIdSchema } from "@/lib/validation/courses";

export type EnrollmentActionState = { error: string } | { success: string } | undefined;

/**
 * Student self-enroll. The course read goes through the session client, so
 * RLS (0010) already limits it to published, non-archived courses in the
 * student's own institute; enrollments_insert_self (0011) re-validates the
 * same thing at insert time.
 */
export async function enrollInCourse(
  _prevState: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const actor = await requireTenantRole(["student"]);

  const parsed = courseIdSchema.safeParse({ courseId: formField(formData, "courseId") });
  if (!parsed.success) return { error: "Invalid request." };
  if (!actor.instituteId) return { error: "Could not enroll you in this course." };

  const supabase = await createServerClient();
  const { data: course } = await supabase
    .from("courses")
    .select("id, institute_id, status, archived_at")
    .eq("id", parsed.data.courseId)
    .maybeSingle();

  if (
    !course ||
    course.institute_id !== actor.instituteId ||
    course.status !== "published" ||
    course.archived_at !== null
  ) {
    return { error: "Course not found." };
  }

  const { data, error } = await supabase
    .from("enrollments")
    .insert({
      institute_id: actor.instituteId,
      course_id: course.id,
      student_id: actor.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    return {
      error:
        error?.code === "23505"
          ? "You're already enrolled in this course."
          : "Could not enroll you in this course.",
    };
  }

  await logAudit({
    instituteId: actor.instituteId,
    actorId: actor.id,
    action: "enrollment.created",
    target: data.id,
    metadata: { courseId: course.id },
    ip: await getClientIp(),
  });

  refresh();
  return { success: "You're enrolled." };
}
