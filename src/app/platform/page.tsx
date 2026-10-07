import { requireRole } from "@/lib/auth/guard";
import { signOut } from "@/lib/auth/actions";
import { createServerClient } from "@/lib/supabase/server";
import { CreateInstituteForm } from "@/components/platform/create-institute-form";
import { AssignOwnerForm } from "@/components/platform/assign-owner-form";
import { InstituteStatusForm } from "@/components/platform/institute-status-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function PlatformPage() {
  const profile = await requireRole(["super_admin"]);

  // Session-bound client, not admin — super_admin's own RLS grant
  // (institutes_select_own_or_super_admin) already covers "see every
  // institute", so there's no need for the service-role client here.
  const supabase = await createServerClient();
  const { data: institutes } = await supabase
    .from("institutes")
    .select("id, name, subdomain, status, created_at")
    .order("created_at", { ascending: false });

  const instituteList = institutes ?? [];

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Platform admin</h1>
          <p className="text-muted-foreground text-sm">
            Signed in as {profile.fullName ?? profile.id}
          </p>
        </div>
        <form action={signOut}>
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Institutes</CardTitle>
        </CardHeader>
        <CardContent>
          {instituteList.length === 0 ? (
            <p className="text-muted-foreground text-sm">No institutes yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="py-2 font-medium">Name</th>
                  <th className="py-2 font-medium">Subdomain</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {instituteList.map((institute) => (
                  <tr key={institute.id} className="border-b last:border-0">
                    <td className="py-2">{institute.name}</td>
                    <td className="py-2">{institute.subdomain}</td>
                    <td className="py-2">
                      <span
                        className={
                          institute.status === "active"
                            ? "text-green-700"
                            : "text-destructive"
                        }
                      >
                        {institute.status}
                      </span>
                    </td>
                    <td className="py-2">
                      <InstituteStatusForm
                        instituteId={institute.id}
                        currentStatus={institute.status as "active" | "suspended"}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-8 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Create institute</CardTitle>
          </CardHeader>
          <CardContent>
            <CreateInstituteForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assign owner</CardTitle>
          </CardHeader>
          <CardContent>
            <AssignOwnerForm
              institutes={instituteList.map((i) => ({ id: i.id, name: i.name }))}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
