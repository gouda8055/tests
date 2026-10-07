import "server-only";
import { headers } from "next/headers";

/**
 * Best-effort client IP from the standard forwarding headers Vercel (and
 * most reverse proxies) set. Used for rate-limit buckets and audit log
 * entries — never for anything access-control-critical on its own, since
 * these headers are proxy-set, not cryptographically verified.
 */
export async function getClientIp(): Promise<string | null> {
  const headerList = await headers();

  const forwardedFor = headerList.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  return headerList.get("x-real-ip");
}
