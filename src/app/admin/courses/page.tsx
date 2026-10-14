import Link from "next/link";

import { requireTenantRole } from "@/lib/auth/guard";
import { createCourse } from "@/lib/courses/actions";
import { formatDateTime } from "@/lib/format";
import { createServerClient } from "@/lib/supabase/server";
import { CourseForm } from "@/components/courses/course-form";
import { CourseList } from "@/components/courses/course-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AdminCoursesPage() {
  const profile = await requireTenantRole(["institute_owner", "instructor"]);

  // RLS (0010) scopes this to the caller's institute, drafts included for staff.
  const supabase = await createServerClient();
  const { data: courses } = await supabase
    .from("courses")
    .select("id, title, status, archived_at, created_by, created_at")
    .order("created_at", { ascending: false });

  const courseList = (courses ?? []).map((course) => ({
    id: course.id as string,
    title: course.title as string,
    status: course.status as string,
    archivedAt: course.archived_at as string | null,
    ownerLabel: course.created_by === profile.id ? "You" : "Another instructor",
    createdAtLabel: formatDateTime(course.created_at as string),
  }));

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 p-8">
      <div>
        <Link href="/admin" className="text-muted-foreground text-sm hover:underline">
          ← Admin
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Courses</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All courses</CardTitle>
        </CardHeader>
        <CardContent>
          <CourseList courses={courseList} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create course</CardTitle>
        </CardHeader>
        <CardContent>
          <CourseForm action={createCourse} />
        </CardContent>
      </Card>
    </main>
  );
}
