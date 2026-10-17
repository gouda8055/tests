"use server";

import { refresh } from "next/cache";

import { requireTenantRole } from "@/lib/auth/guard";
import { logAudit } from "@/lib/audit/log";
import { canManage } from "@/lib/courses/ownership";
import { formField } from "@/lib/form-data";
import { notifyEnrollmentConfirmed } from "@/lib/notifications/send";
import { getClientIp } from "@/lib/request-ip";
import { createServerClient } from "@/lib/supabase/server";
import { courseIdSchema, enrollmentIdSchema } from "@/lib/validation/courses";

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
    .select("id, institute_id, status, archived_at, title")
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

  await notifyEnrollmentConfirmed({ studentId: actor.id, courseTitle: course.title });

  refresh();
  return { success: "You're enrolled." };
}

/**
 * Unenroll (Stage 4): either the student removing their own enrollment, or
 * institute staff removing a student from a course's roster. The RLS
 * delete policy (0021) is the real boundary for both cases — this just
 * loads the enrollment first so it can return a friendly error, and to
 * decide which success message to show.
 */
export async function unenrollFromCourse(
  _prevState: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const actor = await requireTenantRole(["student", "institute_owner", "instructor"]);

  const parsed = enrollmentIdSchema.safeParse({
    enrollmentId: formField(formData, "enrollmentId"),
  });
  if (!parsed.success) return { error: "Invalid request." };

  const supabase = await createServerClient();
  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id, course_id, student_id, courses(created_by)")
    .eq("id", parsed.data.enrollmentId)
    .maybeSingle();
  if (!enrollment) return { error: "Enrollment not found." };

  const course = enrollment.courses as unknown as { created_by: string | null } | null;
  const isSelf = enrollment.student_id === actor.id;
  const isStaffManager = actor.role !== "student" && Boolean(course) && canManage(actor, course!.created_by);
  if (!isSelf && !isStaffManager) {
    return { error: "You can't remove this enrollment." };
  }

  const { data, error } = await supabase
    .from("enrollments")
    .delete()
    .eq("id", enrollment.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return { error: "Could not remove this enrollment." };

  await logAudit({
    instituteId: actor.instituteId,
    actorId: actor.id,
    action: "enrollment.deleted",
    target: enrollment.id,
    metadata: {
      courseId: enrollment.course_id,
      studentId: enrollment.student_id,
      self: isSelf,
    },
    ip: await getClientIp(),
  });

  refresh();
  return { success: isSelf ? "You're unenrolled." : "Student removed from the course." };
}
