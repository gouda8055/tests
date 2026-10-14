import Link from "next/link";

import { requireTenantRole } from "@/lib/auth/guard";
import { getProfileNames } from "@/lib/audit/names";
import { formatDateTime } from "@/lib/format";
import { createServerClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = 100;

/**
 * institute_owner only — audit_logs_select_super_admin_or_owner
 * (0005_rls_policies.sql) never grants instructor or student read access,
 * by design (SECURITY.md §10). RLS already scopes the query below to the
 * caller's own institute; no institute_id filter is needed here.
 */
export default async function AuditLogPage() {
  const profile = await requireTenantRole(["institute_owner"]);

  const supabase = await createServerClient();
  const { data: entries } = await supabase
    .from("audit_logs")
    .select("id, actor_id, action, target, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  const entryList = entries ?? [];
  const names = profile.instituteId
    ? await getProfileNames(
        profile.instituteId,
        entryList.flatMap((entry) => (entry.actor_id ? [entry.actor_id as string] : [])),
      )
    : new Map<string, string>();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-8">
      <div>
        <Link href="/admin" className="text-muted-foreground text-sm hover:underline">
          ← Admin
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Audit log</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            Most recent {entryList.length} entr{entryList.length === 1 ? "y" : "ies"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {entryList.length === 0 ? (
            <p className="text-muted-foreground text-sm">No activity recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entryList.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {formatDateTime(entry.created_at)}
                    </TableCell>
                    <TableCell>
                      {entry.actor_id
                        ? (names.get(entry.actor_id as string) ?? "Unknown")
                        : "System"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {entry.target ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
