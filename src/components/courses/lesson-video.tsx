import { getVideoPlaybackUrl } from "@/lib/video/actions";

/**
 * Server component: signs a short-lived Bunny Stream URL for the lesson
 * (authorization happens inside getVideoPlaybackUrl via RLS) and embeds the
 * Bunny player. Renders a plain notice instead when Bunny isn't configured.
 */
export async function LessonVideo({ lessonId }: { lessonId: string }) {
  const result = await getVideoPlaybackUrl(lessonId);

  if ("error" in result) {
    return (
      <div className="bg-muted text-muted-foreground rounded-md p-4 text-sm">
        {result.error}
      </div>
    );
  }

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-md border">
      <iframe
        src={result.url}
        title="Lesson video"
        loading="lazy"
        className="absolute inset-0 h-full w-full"
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}
