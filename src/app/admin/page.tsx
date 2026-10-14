import Link from "next/link";

import { requireTenantRole } from "@/lib/auth/guard";
import { signOut } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";

export default async function AdminPage() {
  const profile = await requireTenantRole(["institute_owner", "instructor"]);

  return (
    <main className="flex flex-1 flex-col gap-4 p-8">
      <h1 className="text-xl font-semibold">Admin</h1>
      <p className="text-muted-foreground text-sm">
        Signed in as {profile.fullName ?? profile.id} ({profile.role})
      </p>
      <Button asChild className="self-start">
        <Link href="/admin/courses">Manage courses</Link>
      </Button>
      {profile.role === "institute_owner" ? (
        <Button asChild variant="outline" className="self-start">
          <Link href="/admin/audit-log">Audit log</Link>
        </Button>
      ) : null}
      <Button asChild variant="outline" className="self-start">
        <Link href="/admin/settings">Settings</Link>
      </Button>
      <form action={signOut}>
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </main>
  );
}
