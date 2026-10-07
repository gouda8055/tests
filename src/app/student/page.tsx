import Link from "next/link";

import { requireTenantRole } from "@/lib/auth/guard";
import { signOut } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";

export default async function StudentPage() {
  const profile = await requireTenantRole(["student"]);

  return (
    <main className="flex flex-1 flex-col gap-4 p-8">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <p className="text-muted-foreground text-sm">
        Welcome, {profile.fullName ?? profile.id}
      </p>
      <Button asChild className="self-start">
        <Link href="/student/courses">Browse courses</Link>
      </Button>
      <form action={signOut}>
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </main>
  );
}
