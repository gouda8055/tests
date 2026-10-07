import { requireTenantRole } from "@/lib/auth/guard";
import { signOut } from "@/lib/auth/actions";
import { getCurrentTenant } from "@/lib/tenant/current";
import { Button } from "@/components/ui/button";

export default async function StudentPage() {
  const profile = await requireTenantRole(["student"]);
  const tenant = await getCurrentTenant();

  return (
    <main className="flex flex-1 flex-col gap-4 p-8">
      <h1 className="text-xl font-semibold">{tenant?.name}</h1>
      <p className="text-muted-foreground text-sm">
        Welcome, {profile.fullName ?? profile.id}
      </p>
      <form action={signOut}>
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </main>
  );
}
