"use client";

import { useActionState } from "react";

import { startAttempt } from "@/lib/quizzes/attempt-actions";
import { Button } from "@/components/ui/button";

export function StartAttemptForm({ quizId, label }: { quizId: string; label: string }) {
  const [state, formAction, pending] = useActionState(startAttempt, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="quizId" value={quizId} />
      {state && "error" in state ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Starting…" : label}
      </Button>
    </form>
  );
}
