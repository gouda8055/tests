import Link from "next/link";

import { requireTenantRole } from "@/lib/auth/guard";
import { createServerClient } from "@/lib/supabase/server";
import { StudentCourseGrid } from "@/components/courses/student-course-grid";

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
  const courseList = (courses ?? []).map((course) => ({
    id: course.id as string,
    title: course.title as string,
    description: course.description as string | null,
    enrolled: enrolled.has(course.id as string),
  }));

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-8">
      <div>
        <Link href="/student" className="text-muted-foreground text-sm hover:underline">
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Courses</h1>
      </div>
      <StudentCourseGrid courses={courseList} />
    </main>
  );
}
