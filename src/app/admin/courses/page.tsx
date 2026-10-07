import Link from "next/link";

import { requireTenantRole } from "@/lib/auth/guard";
import { createCourse } from "@/lib/courses/actions";
import { formatDateTime } from "@/lib/format";
import { createServerClient } from "@/lib/supabase/server";
import { CourseForm } from "@/components/courses/course-form";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function AdminCoursesPage() {
  const profile = await requireTenantRole(["institute_owner", "instructor"]);

  // RLS (0010) scopes this to the caller's institute, drafts included for staff.
  const supabase = await createServerClient();
  const { data: courses } = await supabase
    .from("courses")
    .select("id, title, status, archived_at, created_by, created_at")
    .order("created_at", { ascending: false });

  const courseList = courses ?? [];

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
          {courseList.length === 0 ? (
            <p className="text-muted-foreground text-sm">No courses yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {courseList.map((course) => (
                  <TableRow key={course.id}>
                    <TableCell>
                      <Link
                        href={`/admin/courses/${course.id}`}
                        className="font-medium hover:underline"
                      >
                        {course.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={course.status}
                        archivedAt={course.archived_at}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {course.created_by === profile.id ? "You" : "Another instructor"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(course.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
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
