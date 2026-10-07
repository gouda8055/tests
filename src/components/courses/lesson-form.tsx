"use client";

import { useActionState } from "react";

import type { LessonActionState } from "@/lib/lessons/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type LessonFormAction = (
  state: LessonActionState,
  formData: FormData,
) => Promise<LessonActionState>;

/** Create (pass courseId) or edit (pass lesson) a lesson. */
export function LessonForm({
  action,
  courseId,
  lesson,
}: {
  action: LessonFormAction;
  courseId?: string;
  lesson?: { id: string; title: string; content: string | null; videoId: string | null };
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {lesson ? <input type="hidden" name="lessonId" value={lesson.id} /> : null}
      {!lesson && courseId ? (
        <input type="hidden" name="courseId" value={courseId} />
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="lessonTitle">Title</Label>
        <Input
          id="lessonTitle"
          name="title"
          type="text"
          required
          maxLength={200}
          defaultValue={lesson?.title}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="lessonContent">Content (Markdown)</Label>
        <Textarea
          id="lessonContent"
          name="content"
          rows={16}
          maxLength={50000}
          className="font-mono"
          defaultValue={lesson?.content ?? ""}
        />
        <p className="text-muted-foreground text-xs">
          Markdown with GitHub-style tables and lists. Raw HTML is not rendered.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="lessonVideoId">Bunny Stream video ID (optional)</Label>
        <Input
          id="lessonVideoId"
          name="videoId"
          type="text"
          maxLength={100}
          placeholder="e.g. 3f1c2a7e-…"
          defaultValue={lesson?.videoId ?? ""}
        />
      </div>
      {state && "error" in state ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      {state && "success" in state ? (
        <p className="text-sm text-green-700">{state.success}</p>
      ) : null}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : lesson ? "Save lesson" : "Create lesson"}
      </Button>
    </form>
  );
}
