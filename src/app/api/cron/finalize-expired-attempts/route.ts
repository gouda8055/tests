import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/env.server";
import { finalizeAllExpiredAttempts } from "@/lib/quizzes/cron";

/**
 * Vercel Cron target — see vercel.json for the schedule. Vercel sends
 * `Authorization: Bearer ${CRON_SECRET}` automatically on scheduled
 * invocations once CRON_SECRET exists as an env var on the project
 * (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
 * Without it set, this route refuses to run rather than executing
 * unauthenticated — same "dormant until configured" treatment Stage 2 gave
 * Bunny Stream.
 */
export async function GET(request: Request) {
  if (!serverEnv.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${serverEnv.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await finalizeAllExpiredAttempts();
  return NextResponse.json(result);
}
