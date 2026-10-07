"use client";

import { useActionState } from "react";

import { enrollInCourse } from "@/lib/enrollment/actions";
import { Button } from "@/components/ui/button";

export function EnrollForm({ courseId }: { courseId: string }) {
  const [state, formAction, pending] = useActionState(enrollInCourse, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="courseId" value={courseId} />
      {state && "error" in state ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      {state && "success" in state ? (
        <p className="text-sm text-green-700">{state.success}</p>
      ) : null}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Enrolling…" : "Enroll in this course"}
      </Button>
    </form>
  );
}
