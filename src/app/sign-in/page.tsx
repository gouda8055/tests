import { redirect } from "next/navigation";

import { getSessionProfile } from "@/lib/auth/guard";
import { SignInForm } from "@/components/auth/sign-in-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function redirectForRole(role: string): never {
  if (role === "super_admin") redirect("/platform");
  if (role === "institute_owner" || role === "instructor") redirect("/admin");
  redirect("/student");
}

export default async function SignInPage() {
  const profile = await getSessionProfile();
  if (profile) redirectForRole(profile.role);

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          <SignInForm />
        </CardContent>
      </Card>
    </main>
  );
}
