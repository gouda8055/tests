import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTenantRole } from "@/lib/auth/guard";
import { canManage } from "@/lib/courses/ownership";
import { createQuestion } from "@/lib/quizzes/actions";
import { createServerClient } from "@/lib/supabase/server";
import { QuestionForm } from "@/components/quizzes/question-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function NewQuestionPage({
  params,
}: {
  params: Promise<{ courseId: string; quizId: string }>;
}) {
  const profile = await requireTenantRole(["institute_owner", "instructor"]);
  const { courseId, quizId } = await params;

  const supabase = await createServerClient();
  const { data: quiz } = await supabase
    .from("quizzes")
    .select("id, course_id, title, created_by")
    .eq("id", quizId)
    .eq("course_id", courseId)
    .maybeSingle();
  if (!quiz) notFound();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <div>
        <Link
          href={`/admin/courses/${quiz.course_id}/quizzes/${quiz.id}`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← {quiz.title}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Add question</h1>
      </div>
      {canManage(profile, quiz.created_by) ? (
        <Card>
          <CardHeader>
            <CardTitle>Question</CardTitle>
          </CardHeader>
          <CardContent>
            <QuestionForm action={createQuestion} quizId={quiz.id} />
          </CardContent>
        </Card>
      ) : (
        <p className="text-muted-foreground text-sm">
          Only this quiz&apos;s creator or the institute owner can add questions.
        </p>
      )}
    </main>
  );
}
