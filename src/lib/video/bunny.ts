import "server-only";
import { createHash } from "node:crypto";

import { isBunnyConfigured, serverEnv } from "@/lib/env.server";

const PLAYBACK_TOKEN_TTL_SECONDS = 10 * 60;

/**
 * Returns a short-lived, token-authenticated Bunny Stream embed URL for
 * `videoId`, or null when Bunny isn't configured. Implements Bunny's
 * documented embed-view token scheme:
 *   token = SHA256_HEX(token_auth_key + video_id + expires)
 * (https://bunny.net/docs/stream-embed-token-authentication).
 *
 * Callers MUST have already verified the viewer may see this lesson
 * (enrollment + institute) — see src/lib/video/actions.ts. Signed URLs deter
 * link sharing; they do not stop screen recording (SECURITY.md §6).
 * Domain/referrer locking is a Bunny dashboard setting, not code.
 */
export function getSignedPlaybackUrl(videoId: string): string | null {
  const libraryId = serverEnv.BUNNY_STREAM_LIBRARY_ID;
  const tokenAuthKey = serverEnv.BUNNY_STREAM_TOKEN_AUTH_KEY;
  if (!isBunnyConfigured || !libraryId || !tokenAuthKey) return null;

  const expires = Math.floor(Date.now() / 1000) + PLAYBACK_TOKEN_TTL_SECONDS;
  const token = createHash("sha256")
    .update(`${tokenAuthKey}${videoId}${expires}`)
    .digest("hex");

  const url = new URL(
    `https://player.mediadelivery.net/embed/${encodeURIComponent(libraryId)}/${encodeURIComponent(videoId)}`,
  );
  url.searchParams.set("token", token);
  url.searchParams.set("expires", String(expires));
  return url.toString();
}
