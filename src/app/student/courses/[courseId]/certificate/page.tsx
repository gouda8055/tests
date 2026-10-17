import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTenantRole } from "@/lib/auth/guard";
import { getCourseCompletionRequirements } from "@/lib/certificates/requirements";
import { formatDateTime } from "@/lib/format";
import { createServerClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function StudentCertificatePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const profile = await requireTenantRole(["student"]);
  const { courseId } = await params;

  const supabase = await createServerClient();
  const { data: course } = await supabase
    .from("courses")
    .select("id, title")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) notFound();

  const { data: certificate } = await supabase
    .from("certificates")
    .select("id, issued_at")
    .eq("course_id", courseId)
    .eq("student_id", profile.id)
    .maybeSingle();

  const requirements = certificate
    ? []
    : await getCourseCompletionRequirements(courseId, profile.id);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <div>
        <Link
          href={`/student/courses/${course.id}`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← {course.title}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Certificate</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{certificate ? "Certificate earned" : "Not yet earned"}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {certificate ? (
            <>
              <p className="text-muted-foreground text-sm">
                Issued {formatDateTime(certificate.issued_at as string)}.
              </p>
              <Button asChild className="self-start">
                <a href={`/api/certificates/${certificate.id}/pdf`}>Download certificate</a>
              </Button>
              <p className="text-muted-foreground text-xs">
                Anyone can verify this certificate at{" "}
                <Link href={`/verify/${certificate.id}`} className="underline">
                  /verify/{certificate.id}
                </Link>
                .
              </p>
            </>
          ) : requirements.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              This course doesn&apos;t have a certificate set up yet — ask your instructor to
              set a passing score on at least one quiz.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {requirements.map((requirement) => (
                <li
                  key={requirement.quizId}
                  className="flex items-center justify-between gap-2"
                >
                  <span>{requirement.quizTitle}</span>
                  <span
                    className={
                      requirement.passed ? "text-green-700" : "text-muted-foreground"
                    }
                  >
                    {requirement.passed ? "Passed" : `Needs ${requirement.passingScorePercent}%`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
