"use client";

import { useActionState } from "react";

import { createInstitute } from "@/lib/platform/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateInstituteForm() {
  const [state, formAction, pending] = useActionState(createInstitute, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Institute name</Label>
        <Input id="name" name="name" type="text" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="subdomain">Subdomain</Label>
        <Input id="subdomain" name="subdomain" type="text" placeholder="acme" required />
      </div>
      {state && "error" in state ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      {state && "success" in state ? (
        <p className="text-sm text-green-700">{state.success}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create institute"}
      </Button>
    </form>
  );
}
