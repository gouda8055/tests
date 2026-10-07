import Link from "next/link";

import { requireTenantRole } from "@/lib/auth/guard";
import { createServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function StudentCoursesPage() {
  const profile = await requireTenantRole(["student"]);

  // RLS (0010) shows students only published, non-archived courses in
  // their own institute; enrollments RLS (0011) only their own rows.
  const supabase = await createServerClient();
  const [{ data: courses }, { data: enrollments }] = await Promise.all([
    supabase
      .from("courses")
      .select("id, title, description")
      .order("created_at", { ascending: false }),
    supabase.from("enrollments").select("course_id").eq("student_id", profile.id),
  ]);

  const enrolled = new Set((enrollments ?? []).map((row) => row.course_id as string));
  const courseList = courses ?? [];

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-8">
      <div>
        <Link href="/student" className="text-muted-foreground text-sm hover:underline">
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Courses</h1>
      </div>
      {courseList.length === 0 ? (
        <p className="text-muted-foreground text-sm">No courses are available yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {courseList.map((course) => (
            <Link key={course.id} href={`/student/courses/${course.id}`}>
              <Card className="hover:bg-muted/50 h-full transition-colors">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle>{course.title}</CardTitle>
                    {enrolled.has(course.id as string) ? (
                      <Badge variant="success">enrolled</Badge>
                    ) : null}
                  </div>
                  {course.description ? (
                    <CardDescription className="line-clamp-3">
                      {course.description}
                    </CardDescription>
                  ) : null}
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
