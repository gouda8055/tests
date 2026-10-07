import Link from "next/link";

import { getCurrentTenant } from "@/lib/tenant/current";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const tenant = await getCurrentTenant();

  if (tenant) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{tenant.name}</h1>
        <div className="flex gap-3">
          <Button asChild>
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/sign-up">Sign up</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        Multi-Tenant LMS &amp; Exam Platform
      </h1>
      <p className="text-muted-foreground max-w-md text-sm">
        This is the base domain. Each institute is served from its own subdomain.
      </p>
    </main>
  );
}
