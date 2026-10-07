import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTenantRole } from "@/lib/auth/guard";
import { getStudentNames } from "@/lib/courses/student-names";
import { formatDateTime } from "@/lib/format";
import { createServerClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function CourseRosterPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const profile = await requireTenantRole(["institute_owner", "instructor"]);
  const { courseId } = await params;

  const supabase = await createServerClient();
  const { data: course } = await supabase
    .from("courses")
    .select("id, title")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) notFound();

  // RLS (0011) lets institute staff read every enrollment in their institute.
  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("id, student_id, status, enrolled_at")
    .eq("course_id", course.id)
    .order("enrolled_at", { ascending: true });

  const enrollmentList = enrollments ?? [];
  const names = profile.instituteId
    ? await getStudentNames(
        profile.instituteId,
        enrollmentList.map((enrollment) => enrollment.student_id as string),
      )
    : new Map<string, string>();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-8">
      <div>
        <Link
          href={`/admin/courses/${course.id}`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← {course.title}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Roster</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            {enrollmentList.length} enrolled student
            {enrollmentList.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {enrollmentList.length === 0 ? (
            <p className="text-muted-foreground text-sm">No one has enrolled yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Enrolled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrollmentList.map((enrollment) => (
                  <TableRow key={enrollment.id}>
                    <TableCell>
                      {names.get(enrollment.student_id as string) ?? "Unknown student"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {enrollment.status}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(enrollment.enrolled_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
