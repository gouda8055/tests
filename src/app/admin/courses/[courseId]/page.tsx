import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTenantRole } from "@/lib/auth/guard";
import { archiveCourse, setCourseStatus, updateCourse } from "@/lib/courses/actions";
import { canManage } from "@/lib/courses/ownership";
import { formatDuration } from "@/lib/format";
import { reorderLessons } from "@/lib/lessons/actions";
import { createServerClient } from "@/lib/supabase/server";
import { CourseForm } from "@/components/courses/course-form";
import { ActionButtonForm } from "@/components/shared/action-button-form";
import { ConfirmActionDialog } from "@/components/shared/confirm-action-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function swapped(ids: string[], a: number, b: number): string[] {
  const next = [...ids];
  [next[a], next[b]] = [next[b] as string, next[a] as string];
  return next;
}

export default async function AdminCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const profile = await requireTenantRole(["institute_owner", "instructor"]);
  const { courseId } = await params;

  const supabase = await createServerClient();
  const { data: course } = await supabase
    .from("courses")
    .select("id, title, description, status, archived_at, created_by")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) notFound();

  const [{ data: lessons }, { data: quizzes }] = await Promise.all([
    supabase
      .from("lessons")
      .select("id, title, position, status, archived_at, video_id")
      .eq("course_id", course.id)
      .order("position", { ascending: true }),
    supabase
      .from("quizzes")
      .select("id, title, status, archived_at, duration_seconds, max_attempts")
      .eq("course_id", course.id)
      .order("created_at", { ascending: true }),
  ]);

  const editable = canManage(profile, course.created_by);
  const lessonList = lessons ?? [];
  const activeLessonIds = lessonList
    .filter((lesson) => !lesson.archived_at)
    .map((lesson) => lesson.id as string);
  const quizList = quizzes ?? [];
  const nextStatus = course.status === "published" ? "draft" : "published";

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-8">
      <div>
        <Link
          href="/admin/courses"
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Courses
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{course.title}</h1>
          <StatusBadge status={course.status} archivedAt={course.archived_at} />
        </div>
        {course.description ? (
          <p className="text-muted-foreground mt-1 text-sm whitespace-pre-wrap">
            {course.description}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/admin/courses/${course.id}/roster`}>Roster</Link>
        </Button>
        {editable && !course.archived_at ? (
          <>
            <ActionButtonForm
              action={setCourseStatus}
              fields={[
                ["courseId", course.id],
                ["status", nextStatus],
              ]}
              label={nextStatus === "published" ? "Publish" : "Unpublish"}
            />
            <ConfirmActionDialog
              action={archiveCourse}
              fields={[["courseId", course.id]]}
              triggerLabel="Archive"
              title="Archive this course?"
              description="Students will no longer see it. Existing enrollments and attempt records are kept."
              confirmLabel="Archive course"
            />
          </>
        ) : null}
      </div>

      {!editable ? (
        <p className="text-muted-foreground text-sm">
          You can view this course, but only its creator or the institute owner can edit
          it.
        </p>
      ) : null}

      <Tabs defaultValue="lessons">
        <TabsList>
          <TabsTrigger value="lessons">Lessons ({activeLessonIds.length})</TabsTrigger>
          <TabsTrigger value="quizzes">Quizzes ({quizList.length})</TabsTrigger>
          {editable ? <TabsTrigger value="settings">Settings</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="lessons" className="flex flex-col gap-4 pt-2">
          {editable ? (
            <Button asChild size="sm" className="self-start">
              <Link href={`/admin/courses/${course.id}/lessons/new`}>New lesson</Link>
            </Button>
          ) : null}
          {lessonList.length === 0 ? (
            <p className="text-muted-foreground text-sm">No lessons yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Video</TableHead>
                  {editable ? <TableHead>Order</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lessonList.map((lesson) => {
                  const index = activeLessonIds.indexOf(lesson.id as string);
                  return (
                    <TableRow key={lesson.id}>
                      <TableCell className="text-muted-foreground">
                        {index >= 0 ? index + 1 : "—"}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/admin/courses/${course.id}/lessons/${lesson.id}`}
                          className="font-medium hover:underline"
                        >
                          {lesson.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={lesson.status}
                          archivedAt={lesson.archived_at}
                        />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {lesson.video_id ? "Yes" : "No"}
                      </TableCell>
                      {editable ? (
                        <TableCell>
                          {index >= 0 ? (
                            <div className="flex gap-1">
                              <ActionButtonForm
                                action={reorderLessons}
                                fields={[
                                  ["courseId", course.id],
                                  ...swapped(activeLessonIds, index, index - 1).map(
                                    (id): [string, string] => ["lessonIds", id],
                                  ),
                                ]}
                                label="Up"
                                pendingLabel="…"
                                variant="ghost"
                                disabled={index === 0}
                              />
                              <ActionButtonForm
                                action={reorderLessons}
                                fields={[
                                  ["courseId", course.id],
                                  ...swapped(activeLessonIds, index, index + 1).map(
                                    (id): [string, string] => ["lessonIds", id],
                                  ),
                                ]}
                                label="Down"
                                pendingLabel="…"
                                variant="ghost"
                                disabled={index === activeLessonIds.length - 1}
                              />
                            </div>
                          ) : null}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="quizzes" className="flex flex-col gap-4 pt-2">
          {editable ? (
            <Button asChild size="sm" className="self-start">
              <Link href={`/admin/courses/${course.id}/quizzes/new`}>New quiz</Link>
            </Button>
          ) : null}
          {quizList.length === 0 ? (
            <p className="text-muted-foreground text-sm">No quizzes yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Attempts allowed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quizList.map((quiz) => (
                  <TableRow key={quiz.id}>
                    <TableCell>
                      <Link
                        href={`/admin/courses/${course.id}/quizzes/${quiz.id}`}
                        className="font-medium hover:underline"
                      >
                        {quiz.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={quiz.status} archivedAt={quiz.archived_at} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDuration(quiz.duration_seconds)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {quiz.max_attempts}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        {editable ? (
          <TabsContent value="settings" className="pt-2">
            <CourseForm
              action={updateCourse}
              course={{
                id: course.id,
                title: course.title,
                description: course.description,
              }}
            />
          </TabsContent>
        ) : null}
      </Tabs>
    </main>
  );
}
