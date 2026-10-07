import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTenantRole } from "@/lib/auth/guard";
import { canManage } from "@/lib/courses/ownership";
import { archiveLesson, setLessonStatus, updateLesson } from "@/lib/lessons/actions";
import { createServerClient } from "@/lib/supabase/server";
import { LessonForm } from "@/components/courses/lesson-form";
import { LessonVideo } from "@/components/courses/lesson-video";
import { ActionButtonForm } from "@/components/shared/action-button-form";
import { ConfirmActionDialog } from "@/components/shared/confirm-action-dialog";
import { Markdown } from "@/components/shared/markdown";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default async function AdminLessonPage({
  params,
}: {
  params: Promise<{ courseId: string; lessonId: string }>;
}) {
  const profile = await requireTenantRole(["institute_owner", "instructor"]);
  const { courseId, lessonId } = await params;

  const supabase = await createServerClient();
  const [{ data: course }, { data: lesson }] = await Promise.all([
    supabase
      .from("courses")
      .select("id, title, created_by")
      .eq("id", courseId)
      .maybeSingle(),
    supabase
      .from("lessons")
      .select("id, course_id, title, content, video_id, status, archived_at")
      .eq("id", lessonId)
      .eq("course_id", courseId)
      .maybeSingle(),
  ]);
  if (!course || !lesson) notFound();

  const editable = canManage(profile, course.created_by);
  const nextStatus = lesson.status === "published" ? "draft" : "published";

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-8">
      <div>
        <Link
          href={`/admin/courses/${course.id}`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← {course.title}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{lesson.title}</h1>
          <StatusBadge status={lesson.status} archivedAt={lesson.archived_at} />
        </div>
      </div>

      {editable && !lesson.archived_at ? (
        <div className="flex flex-wrap items-start gap-2">
          <ActionButtonForm
            action={setLessonStatus}
            fields={[
              ["lessonId", lesson.id],
              ["status", nextStatus],
            ]}
            label={nextStatus === "published" ? "Publish" : "Unpublish"}
          />
          <ConfirmActionDialog
            action={archiveLesson}
            fields={[["lessonId", lesson.id]]}
            triggerLabel="Archive"
            title="Archive this lesson?"
            description="Students will no longer see it."
            confirmLabel="Archive lesson"
          />
        </div>
      ) : null}

      <Tabs defaultValue={editable ? "edit" : "preview"}>
        <TabsList>
          {editable ? <TabsTrigger value="edit">Edit</TabsTrigger> : null}
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>
        {editable ? (
          <TabsContent value="edit" className="pt-2">
            <Card>
              <CardContent className="pt-6">
                <LessonForm
                  action={updateLesson}
                  lesson={{
                    id: lesson.id,
                    title: lesson.title,
                    content: lesson.content,
                    videoId: lesson.video_id,
                  }}
                />
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}
        <TabsContent value="preview" className="pt-2">
          <Card>
            <CardHeader>
              <CardTitle>{lesson.title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {lesson.video_id ? <LessonVideo lessonId={lesson.id} /> : null}
              {lesson.content ? <Markdown content={lesson.content} /> : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  );
}
