import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTenantRole } from "@/lib/auth/guard";
import { canManage } from "@/lib/courses/ownership";
import { createQuiz } from "@/lib/quizzes/actions";
import { createServerClient } from "@/lib/supabase/server";
import { QuizForm } from "@/components/quizzes/quiz-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function NewQuizPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const profile = await requireTenantRole(["institute_owner", "instructor"]);
  const { courseId } = await params;

  const supabase = await createServerClient();
  const { data: course } = await supabase
    .from("courses")
    .select("id, title, created_by")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) notFound();

  const { data: lessons } = await supabase
    .from("lessons")
    .select("id, title")
    .eq("course_id", course.id)
    .is("archived_at", null)
    .order("position", { ascending: true });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <div>
        <Link
          href={`/admin/courses/${course.id}`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← {course.title}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">New quiz</h1>
      </div>
      {canManage(profile, course.created_by) ? (
        <Card>
          <CardHeader>
            <CardTitle>Quiz settings</CardTitle>
          </CardHeader>
          <CardContent>
            <QuizForm
              action={createQuiz}
              courseId={course.id}
              lessons={(lessons ?? []).map((lesson) => ({
                id: lesson.id as string,
                title: lesson.title as string,
              }))}
            />
          </CardContent>
        </Card>
      ) : (
        <p className="text-muted-foreground text-sm">
          Only this course&apos;s creator or the institute owner can add quizzes.
        </p>
      )}
    </main>
  );
}
