import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTenantRole } from "@/lib/auth/guard";
import { isRazorpayConfigured } from "@/lib/env.server";
import { unenrollFromCourse } from "@/lib/enrollment/actions";
import { formatDuration, formatPrice } from "@/lib/format";
import { createServerClient } from "@/lib/supabase/server";
import { EnrollForm } from "@/components/courses/enroll-form";
import { CheckoutButton } from "@/components/payments/checkout-button";
import { ConfirmActionDialog } from "@/components/shared/confirm-action-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function StudentCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const profile = await requireTenantRole(["student"]);
  const { courseId } = await params;

  const supabase = await createServerClient();
  const [{ data: course }, { data: enrollment }] = await Promise.all([
    supabase
      .from("courses")
      .select("id, title, description, price_paise, currency")
      .eq("id", courseId)
      .maybeSingle(),
    supabase
      .from("enrollments")
      .select("id")
      .eq("course_id", courseId)
      .eq("student_id", profile.id)
      .maybeSingle(),
  ]);
  if (!course) notFound();

  // Lessons/quizzes RLS (0012/0013) return rows only once enrolled, and
  // only published + non-archived ones.
  const [{ data: lessons }, { data: quizzes }] = enrollment
    ? await Promise.all([
        supabase
          .from("lessons")
          .select("id, title")
          .eq("course_id", course.id)
          .order("position", { ascending: true }),
        supabase
          .from("quizzes")
          .select("id, title, duration_seconds")
          .eq("course_id", course.id)
          .order("created_at", { ascending: true }),
      ])
    : [{ data: [] }, { data: [] }];

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/student/courses"
            className="text-muted-foreground text-sm hover:underline"
          >
            ← Courses
          </Link>
          <h1 className="mt-2 text-xl font-semibold">{course.title}</h1>
          {course.description ? (
            <p className="text-muted-foreground mt-1 text-sm whitespace-pre-wrap">
              {course.description}
            </p>
          ) : null}
        </div>
        {enrollment ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/student/courses/${course.id}/certificate`}>Certificate</Link>
            </Button>
            <ConfirmActionDialog
              action={unenrollFromCourse}
              fields={[["enrollmentId", enrollment.id]]}
              triggerLabel="Unenroll"
              title="Unenroll from this course?"
              description="You'll lose access to its lessons and quizzes until you re-enroll. Your existing attempt records are kept."
              confirmLabel="Confirm unenroll"
            />
          </div>
        ) : null}
      </div>

      {!enrollment ? (
        <Card>
          <CardHeader>
            <CardTitle>Enroll to start learning</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-muted-foreground text-sm">
              Lessons and quizzes unlock once you enroll.{" "}
              {course.price_paise ? (
                <span className="font-medium">{formatPrice(course.price_paise, course.currency)}</span>
              ) : null}
            </p>
            {course.price_paise ? (
              isRazorpayConfigured ? (
                <CheckoutButton
                  courseId={course.id}
                  pricePaise={course.price_paise}
                  currency={course.currency}
                  studentName={profile.fullName}
                />
              ) : (
                <p className="text-muted-foreground text-sm">
                  Payments aren&apos;t configured for this institute yet.
                </p>
              )
            ) : (
              <EnrollForm courseId={course.id} />
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Lessons</CardTitle>
            </CardHeader>
            <CardContent>
              {(lessons ?? []).length === 0 ? (
                <p className="text-muted-foreground text-sm">No lessons yet.</p>
              ) : (
                <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
                  {(lessons ?? []).map((lesson) => (
                    <li key={lesson.id}>
                      <Link
                        href={`/student/courses/${course.id}/lessons/${lesson.id}`}
                        className="hover:underline"
                      >
                        {lesson.title}
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Quizzes</CardTitle>
            </CardHeader>
            <CardContent>
              {(quizzes ?? []).length === 0 ? (
                <p className="text-muted-foreground text-sm">No quizzes yet.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {(quizzes ?? []).map((quiz) => (
                    <li key={quiz.id} className="flex items-center justify-between gap-2">
                      <Link
                        href={`/student/courses/${course.id}/quizzes/${quiz.id}`}
                        className="hover:underline"
                      >
                        {quiz.title}
                      </Link>
                      <span className="text-muted-foreground">
                        {formatDuration(quiz.duration_seconds)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
