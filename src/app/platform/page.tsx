import { requireRole } from "@/lib/auth/guard";
import { signOut } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";

export default async function PlatformPage() {
  const profile = await requireRole(["super_admin"]);

  return (
    <main className="flex flex-1 flex-col gap-4 p-8">
      <h1 className="text-xl font-semibold">Platform admin</h1>
      <p className="text-muted-foreground text-sm">
        Signed in as {profile.fullName ?? profile.id}
      </p>
      <form action={signOut}>
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </main>
  );
}
