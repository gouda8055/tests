import { formatDateTime } from "@/lib/format";
import { getStudentNames } from "@/lib/courses/student-names";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Intentionally public — no auth guard at all. The whole point is that
 * someone without an account (e.g. an employer) can check a certificate
 * is real. One narrow, justified service-role read (same "narrow and
 * justified" precedent as every other service-role use in this
 * codebase), selecting only the minimal safe fields.
 */
export default async function VerifyCertificatePage({
  params,
}: {
  params: Promise<{ certificateId: string }>;
}) {
  const { certificateId } = await params;

  const admin = createAdminClient();
  const { data: certificate } = await admin
    .from("certificates")
    .select("id, institute_id, student_id, issued_at, courses(title), institutes(name)")
    .eq("id", certificateId)
    .maybeSingle();

  const course = certificate?.courses as unknown as { title: string } | null;
  const institute = certificate?.institutes as unknown as { name: string } | null;

  const studentName =
    certificate && course && institute
      ? ((
          await getStudentNames(certificate.institute_id as string, [
            certificate.student_id as string,
          ])
        ).get(certificate.student_id as string) ?? "Student")
      : null;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 p-8">
      <h1 className="text-xl font-semibold">Certificate verification</h1>
      <Card>
        <CardHeader>
          <CardTitle>
            {certificate && course && institute ? "Valid certificate" : "Certificate not found"}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {certificate && course && institute ? (
            <p>
              <strong>{studentName}</strong> completed <strong>{course.title}</strong> at{" "}
              <strong>{institute.name}</strong> on{" "}
              {formatDateTime(certificate.issued_at as string)}.
            </p>
          ) : (
            <p className="text-muted-foreground">
              No certificate matches this verification code.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
