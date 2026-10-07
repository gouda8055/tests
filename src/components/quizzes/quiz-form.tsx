"use client";

import { useActionState } from "react";

import type { QuizActionState } from "@/lib/quizzes/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type QuizFormAction = (
  state: QuizActionState,
  formData: FormData,
) => Promise<QuizActionState>;

export type QuizFormValues = {
  id: string;
  title: string;
  description: string | null;
  lessonId: string | null;
  durationSeconds: number;
  graceSeconds: number;
  maxAttempts: number;
  randomizeQuestions: boolean;
  randomizeOptions: boolean;
  showAnswersAfterSubmit: boolean;
};

/** Create (pass courseId) or edit (pass quiz) a quiz's settings. */
export function QuizForm({
  action,
  courseId,
  quiz,
  lessons,
}: {
  action: QuizFormAction;
  courseId?: string;
  quiz?: QuizFormValues;
  lessons: { id: string; title: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {quiz ? <input type="hidden" name="quizId" value={quiz.id} /> : null}
      {!quiz && courseId ? (
        <input type="hidden" name="courseId" value={courseId} />
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="quizTitle">Title</Label>
        <Input
          id="quizTitle"
          name="title"
          type="text"
          required
          maxLength={200}
          defaultValue={quiz?.title}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="quizDescription">Instructions (optional)</Label>
        <Textarea
          id="quizDescription"
          name="description"
          rows={3}
          maxLength={5000}
          defaultValue={quiz?.description ?? ""}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="quizLesson">Attach to lesson (optional)</Label>
        <Select name="lessonId" defaultValue={quiz?.lessonId ?? "none"}>
          <SelectTrigger id="quizLesson">
            <SelectValue placeholder="Not attached to a lesson" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Not attached to a lesson</SelectItem>
            {lessons.map((lesson) => (
              <SelectItem key={lesson.id} value={lesson.id}>
                {lesson.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quizDuration">Duration (minutes)</Label>
          <Input
            id="quizDuration"
            name="durationMinutes"
            type="number"
            min={1}
            max={600}
            required
            defaultValue={quiz ? Math.round(quiz.durationSeconds / 60) : 30}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quizGrace">Grace period (seconds)</Label>
          <Input
            id="quizGrace"
            name="graceSeconds"
            type="number"
            min={0}
            max={600}
            required
            defaultValue={quiz?.graceSeconds ?? 30}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quizAttempts">Attempts allowed</Label>
          <Input
            id="quizAttempts"
            name="maxAttempts"
            type="number"
            min={1}
            max={100}
            required
            defaultValue={quiz?.maxAttempts ?? 1}
          />
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id="randomizeQuestions"
            name="randomizeQuestions"
            defaultChecked={quiz?.randomizeQuestions ?? true}
          />
          <Label htmlFor="randomizeQuestions">Shuffle question order per attempt</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="randomizeOptions"
            name="randomizeOptions"
            defaultChecked={quiz?.randomizeOptions ?? true}
          />
          <Label htmlFor="randomizeOptions">Shuffle option order per attempt</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="showAnswersAfterSubmit"
            name="showAnswersAfterSubmit"
            defaultChecked={quiz?.showAnswersAfterSubmit ?? false}
          />
          <Label htmlFor="showAnswersAfterSubmit">
            Show correct answers to students after they submit
          </Label>
        </div>
      </div>
      {state && "error" in state ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      {state && "success" in state ? (
        <p className="text-sm text-green-700">{state.success}</p>
      ) : null}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : quiz ? "Save quiz" : "Create quiz"}
      </Button>
    </form>
  );
}
