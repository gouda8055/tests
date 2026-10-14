"use client";

import { useActionState } from "react";

import { updateFullName } from "@/lib/account/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function UpdateNameForm({ fullName }: { fullName: string | null }) {
  const [state, formAction, pending] = useActionState(updateFullName, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fullName">Full name</Label>
        <Input
          id="fullName"
          name="fullName"
          type="text"
          required
          maxLength={200}
          defaultValue={fullName ?? ""}
        />
      </div>
      {state && "error" in state ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      {state && "success" in state ? (
        <p className="text-sm text-green-700">{state.success}</p>
      ) : null}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Save name"}
      </Button>
    </form>
  );
}
