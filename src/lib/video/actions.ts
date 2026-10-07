"use server";

import { z } from "zod";

import { requireTenantRole } from "@/lib/auth/guard";
import { isBunnyConfigured } from "@/lib/env.server";
import { createServerClient } from "@/lib/supabase/server";
import { getSignedPlaybackUrl } from "@/lib/video/bunny";

export type VideoPlaybackResult = { error: string } | { url: string };

const NOT_CONFIGURED = "Video playback is not configured for this institute yet.";

/**
 * Returns a short-lived signed playback URL for a lesson's video. The lesson
 * is loaded through the session client, so lessons_select (0012) is what
 * verifies institute + (staff, or enrolled student and published) before
 * any URL is signed (SECURITY.md §6). Read-only: no audit entry.
 */
export async function getVideoPlaybackUrl(
  lessonId: string,
): Promise<VideoPlaybackResult> {
  await requireTenantRole(["institute_owner", "instructor", "student"]);

  const parsed = z.string().uuid().safeParse(lessonId);
  if (!parsed.success) return { error: "Lesson not found." };

  const supabase = await createServerClient();
  const { data: lesson } = await supabase
    .from("lessons")
    .select("id, video_provider, video_id")
    .eq("id", parsed.data)
    .maybeSingle();

  if (!lesson) return { error: "Lesson not found." };
  if (lesson.video_provider !== "bunny" || !lesson.video_id) {
    return { error: "This lesson has no video." };
  }
  if (!isBunnyConfigured) return { error: NOT_CONFIGURED };

  const url = getSignedPlaybackUrl(lesson.video_id);
  if (!url) return { error: NOT_CONFIGURED };
  return { url };
}
