import Link from "next/link";

import { requireTenantRole } from "@/lib/auth/guard";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { UpdateNameForm } from "@/components/account/update-name-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function StudentSettingsPage() {
  const profile = await requireTenantRole(["student"]);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 p-8">
      <div>
        <Link href="/student" className="text-muted-foreground text-sm hover:underline">
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Settings</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <UpdateNameForm fullName={profile.fullName} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </main>
  );
}
