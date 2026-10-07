import { Badge } from "@/components/ui/badge";

export function StatusBadge({
  status,
  archivedAt,
}: {
  status: string;
  archivedAt?: string | null;
}) {
  if (archivedAt) return <Badge variant="destructive">archived</Badge>;
  if (status === "published") return <Badge variant="success">published</Badge>;
  if (status === "submitted") return <Badge variant="success">submitted</Badge>;
  if (status === "timed_out") return <Badge variant="destructive">timed out</Badge>;
  if (status === "in_progress") return <Badge variant="outline">in progress</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}
