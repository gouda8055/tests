import type { SessionProfile } from "@/lib/auth/guard";

/**
 * App-level mirror of the creator-check in the courses/lessons/quizzes/
 * quiz_questions update policies (0010-0014): institute_owner may manage
 * anything in their institute, an instructor only what they created (for
 * lessons/questions, "what they created" means the parent course/quiz).
 * RLS remains the real boundary; this exists so actions can return a
 * friendly error and pages can hide edit controls.
 */
export function canManage(profile: SessionProfile, createdBy: string | null): boolean {
  if (profile.role === "institute_owner") return true;
  return profile.role === "instructor" && createdBy === profile.id;
}
