"use client";

import { useActionState, useState } from "react";

import { changePassword } from "@/lib/account/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, undefined);
  // Bumping this remounts the form (fresh, empty uncontrolled inputs) on
  // success — simpler and safer than a manual form.reset() call, which
  // would need its own dispatch path alongside action={formAction} and
  // risk the exact double-dispatch bug documented across this codebase's
  // other forms (see attempt-runner.tsx's comment on the same issue).
  // Adjusted during render rather than in an effect, per React's own
  // guidance for "state that depends on a changing value" (react.dev/
  // learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const [resetKey, setResetKey] = useState(0);
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state && "success" in state) setResetKey((key) => key + 1);
  }

  return (
    <form key={resetKey} action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type="password" required maxLength={72} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          maxLength={72}
        />
      </div>
      {state && "error" in state ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      {state && "success" in state ? (
        <p className="text-sm text-green-700">{state.success}</p>
      ) : null}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}
