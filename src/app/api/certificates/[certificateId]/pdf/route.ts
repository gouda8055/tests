import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/guard";
import { generateCertificatePdf } from "@/lib/certificates/pdf";
import { getStudentNames } from "@/lib/courses/student-names";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Signed-in is enough here — the real authorization is
 * certificates_select's RLS via the session client: a student can only
 * see their own row, staff only their institute's. No service-role
 * needed at all.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ certificateId: string }> },
) {
  await requireRole(["student", "institute_owner", "instructor"]);
  const { certificateId } = await params;

  const supabase = await createServerClient();
  const { data: certificate } = await supabase
    .from("certificates")
    .select("id, institute_id, student_id, issued_at, courses(title), institutes(name)")
    .eq("id", certificateId)
    .maybeSingle();

  const course = certificate?.courses as unknown as { title: string } | null;
  const institute = certificate?.institutes as unknown as { name: string } | null;
  if (!certificate || !course || !institute) {
    return NextResponse.json({ error: "Certificate not found." }, { status: 404 });
  }

  const names = await getStudentNames(certificate.institute_id as string, [
    certificate.student_id as string,
  ]);
  const studentName = names.get(certificate.student_id as string) ?? "Student";

  const pdfBytes = await generateCertificatePdf({
    studentName,
    courseTitle: course.title,
    instituteName: institute.name,
    issuedAt: new Date(certificate.issued_at as string),
    certificateId: certificate.id as string,
  });

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="certificate-${certificate.id}.pdf"`,
    },
  });
}
