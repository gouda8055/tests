"use client";

import { useActionState } from "react";

import { assignOwner } from "@/lib/platform/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type InstituteOption = { id: string; name: string };

export function AssignOwnerForm({ institutes }: { institutes: InstituteOption[] }) {
  const [state, formAction, pending] = useActionState(assignOwner, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="instituteId">Institute</Label>
        <select
          id="instituteId"
          name="instituteId"
          required
          className="border-input bg-background h-10 rounded-md border px-3 text-sm"
        >
          <option value="">Select an institute…</option>
          {institutes.map((institute) => (
            <option key={institute.id} value={institute.id}>
              {institute.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ownerFullName">Owner full name</Label>
        <Input id="ownerFullName" name="fullName" type="text" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ownerEmail">Owner email</Label>
        <Input id="ownerEmail" name="email" type="email" required />
      </div>
      {state && "error" in state ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      {state && "success" in state ? (
        <p className="text-sm break-words text-green-700">{state.success}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Assign owner"}
      </Button>
    </form>
  );
}
