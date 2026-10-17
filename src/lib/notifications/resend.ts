import "server-only";

import { Resend } from "resend";

import { isResendConfigured, serverEnv } from "@/lib/env.server";

/**
 * Thin send wrapper. Deliberately never throws: a missing provider
 * config or a Resend outage must degrade to "no email sent," never to
 * the calling action (enroll, publish, submit) failing — those are the
 * real operations; the email is an enhancement on top of them.
 */
export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  if (!isResendConfigured) {
    console.warn(`Email not sent (Resend not configured): "${params.subject}" to ${params.to}`);
    return;
  }

  try {
    const resend = new Resend(serverEnv.RESEND_API_KEY!);
    const { error } = await resend.emails.send({
      from: serverEnv.EMAIL_FROM!,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });
    if (error) console.error("Resend send failed:", error.message);
  } catch (error) {
    console.error("Resend send threw:", error);
  }
}
