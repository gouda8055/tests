"use client";

import { useActionState } from "react";

import type { CourseActionState } from "@/lib/courses/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type CourseFormAction = (
  state: CourseActionState,
  formData: FormData,
) => Promise<CourseActionState>;

/** Create or edit a course. */
export function CourseForm({
  action,
  course,
}: {
  action: CourseFormAction;
  course?: { id: string; title: string; description: string | null };
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {course ? <input type="hidden" name="courseId" value={course.id} /> : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="courseTitle">Title</Label>
        <Input
          id="courseTitle"
          name="title"
          type="text"
          required
          maxLength={200}
          defaultValue={course?.title}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="courseDescription">Description (optional)</Label>
        <Textarea
          id="courseDescription"
          name="description"
          rows={4}
          maxLength={5000}
          defaultValue={course?.description ?? ""}
        />
      </div>
      {state && "error" in state ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      {state && "success" in state ? (
        <p className="text-sm text-green-700">{state.success}</p>
      ) : null}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : course ? "Save course" : "Create course"}
      </Button>
    </form>
  );
}
