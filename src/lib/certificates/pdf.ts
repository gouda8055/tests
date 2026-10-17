import "server-only";

import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

/**
 * A single-page, text-only certificate — no logo/branding embedding this
 * stage (institutes does have a logo_url, but image embedding + layout
 * around it is a real scope add, left for later). pdf-lib is pure JS, no
 * native binaries, so this runs fine in a serverless function.
 */
export async function generateCertificatePdf(params: {
  studentName: string;
  courseTitle: string;
  instituteName: string;
  issuedAt: Date;
  certificateId: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([792, 612]); // US Letter, landscape
  const { width, height } = page.getSize();

  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const centerX = (text: string, font = bold, size = 24) =>
    (width - font.widthOfTextAtSize(text, size)) / 2;

  page.drawText(params.instituteName, {
    x: centerX(params.instituteName, regular, 16),
    y: height - 100,
    size: 16,
    font: regular,
    color: rgb(0.3, 0.3, 0.3),
  });

  const title = "Certificate of Completion";
  page.drawText(title, {
    x: centerX(title, bold, 32),
    y: height - 180,
    size: 32,
    font: bold,
  });

  page.drawText(params.studentName, {
    x: centerX(params.studentName, bold, 24),
    y: height - 260,
    size: 24,
    font: bold,
  });

  const courseLine = `has completed ${params.courseTitle}`;
  page.drawText(courseLine, {
    x: centerX(courseLine, regular, 18),
    y: height - 310,
    size: 18,
    font: regular,
  });

  const dateLine = `Issued ${params.issuedAt.toISOString().slice(0, 10)}`;
  page.drawText(dateLine, {
    x: centerX(dateLine, regular, 12),
    y: 100,
    size: 12,
    font: regular,
    color: rgb(0.4, 0.4, 0.4),
  });

  const idLine = `Verification code: ${params.certificateId}`;
  page.drawText(idLine, {
    x: centerX(idLine, regular, 10),
    y: 80,
    size: 10,
    font: regular,
    color: rgb(0.4, 0.4, 0.4),
  });

  return doc.save();
}
