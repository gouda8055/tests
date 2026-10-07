import { setInstituteStatusForm } from "@/lib/platform/actions";
import { Button } from "@/components/ui/button";

/**
 * Plain server-rendered form (no "use client"/useActionState) — a
 * suspend/activate toggle is a rare administrative action, not a
 * frequent user-facing flow, so skipping inline pending/error state here
 * keeps this simple.
 */
export function InstituteStatusForm({
  instituteId,
  currentStatus,
}: {
  instituteId: string;
  currentStatus: "active" | "suspended";
}) {
  const nextStatus = currentStatus === "active" ? "suspended" : "active";

  return (
    <form action={setInstituteStatusForm}>
      <input type="hidden" name="instituteId" value={instituteId} />
      <input type="hidden" name="status" value={nextStatus} />
      <Button type="submit" variant="outline" size="sm">
        {nextStatus === "suspended" ? "Suspend" : "Activate"}
      </Button>
    </form>
  );
}
