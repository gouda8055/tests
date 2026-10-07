import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTenantRole } from "@/lib/auth/guard";
import { createServerClient } from "@/lib/supabase/server";
import { LessonVideo } from "@/components/courses/lesson-video";
import { Markdown } from "@/components/shared/markdown";

export default async function StudentLessonPage({
  params,
}: {
  params: Promise<{ courseId: string; lessonId: string }>;
}) {
  await requireTenantRole(["student"]);
  const { courseId, lessonId } = await params;

  // RLS (0012) returns the lesson only if the student is enrolled and the
  // lesson is published and not archived.
  const supabase = await createServerClient();
  const [{ data: course }, { data: lesson }] = await Promise.all([
    supabase.from("courses").select("id, title").eq("id", courseId).maybeSingle(),
    supabase
      .from("lessons")
      .select("id, title, content, video_id")
      .eq("id", lessonId)
      .eq("course_id", courseId)
      .maybeSingle(),
  ]);
  if (!course || !lesson) notFound();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <div>
        <Link
          href={`/student/courses/${course.id}`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← {course.title}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{lesson.title}</h1>
      </div>
      {lesson.video_id ? <LessonVideo lessonId={lesson.id} /> : null}
      {lesson.content ? <Markdown content={lesson.content} /> : null}
    </main>
  );
}
