import { redirect } from "next/navigation";

import { getSessionProfile } from "@/lib/auth/guard";
import { getCurrentTenant } from "@/lib/tenant/current";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function redirectForRole(role: string): never {
  if (role === "super_admin") redirect("/platform");
  if (role === "institute_owner" || role === "instructor") redirect("/admin");
  redirect("/student");
}

export default async function SignUpPage() {
  const profile = await getSessionProfile();
  if (profile) redirectForRole(profile.role);

  const tenant = await getCurrentTenant();

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{tenant ? `Join ${tenant.name}` : "Sign up"}</CardTitle>
        </CardHeader>
        <CardContent>
          {tenant ? (
            <SignUpForm />
          ) : (
            <p className="text-muted-foreground text-sm">
              Sign up from your institute&apos;s own page, not this one.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
