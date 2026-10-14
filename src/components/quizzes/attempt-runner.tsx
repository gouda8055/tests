"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";

import { saveAnswer, submitAttempt } from "@/lib/quizzes/attempt-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export type RunnerQuestion = {
  id: string;
  type: "single_choice" | "multiple_choice" | "short_answer";
  points: number;
  /** Pre-rendered (server-side) markdown body. */
  body: ReactNode;
  options: { id: string; text: string }[];
};

type AnswerPayload = { selectedOptionIds: string[] } | { textAnswer: string };

type SaveStatus =
  | { state: "pending" }
  | { state: "saving" }
  | { state: "saved" }
  | { state: "error"; message: string };

const AUTOSAVE_DEBOUNCE_MS = 600;

function formatRemaining(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The timed attempt UI. The countdown is cosmetic only: the server owns the
 * clock (SECURITY.md §4) — quiz_attempt_answers' RLS rejects any write past
 * started_at + duration + grace no matter what this component does, and
 * submitAttempt grades a late submit as timed_out. The timer counts down
 * from a server-computed remaining time, so the browser's own clock
 * setting doesn't matter. Autosave is debounced per question and is an
 * idempotent upsert server-side.
 */
export function AttemptRunner({
  attemptId,
  questions,
  initialAnswers,
  initialTextAnswers,
  remainingMs,
}: {
  attemptId: string;
  questions: RunnerQuestion[];
  initialAnswers: Record<string, string[]>;
  initialTextAnswers: Record<string, string>;
  remainingMs: number;
}) {
  const [answers, setAnswers] = useState<Record<string, string[]>>(initialAnswers);
  const [textAnswers, setTextAnswers] =
    useState<Record<string, string>>(initialTextAnswers);
  const [statuses, setStatuses] = useState<Record<string, SaveStatus>>({});
  const [remaining, setRemaining] = useState(remainingMs);
  const [submitState, submitAction, submitting] = useActionState(
    submitAttempt,
    undefined,
  );
  const [, startTransition] = useTransition();

  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const queued = useRef(new Map<string, AnswerPayload>());
  const inFlight = useRef(new Set<Promise<void>>());
  const formRef = useRef<HTMLFormElement>(null);
  const autoSubmitted = useRef(false);

  const runSave = useCallback(
    (questionId: string) => {
      const payload = queued.current.get(questionId);
      timers.current.delete(questionId);
      if (!payload) return;
      queued.current.delete(questionId);

      setStatuses((current) => ({ ...current, [questionId]: { state: "saving" } }));
      const request: Promise<void> = saveAnswer(attemptId, questionId, payload)
        .then((result) => {
          setStatuses((current) => ({
            ...current,
            [questionId]:
              result && "error" in result
                ? { state: "error", message: result.error }
                : { state: "saved" },
          }));
        })
        .catch(() => {
          setStatuses((current) => ({
            ...current,
            [questionId]: {
              state: "error",
              message: "Could not save. Check your connection.",
            },
          }));
        })
        .finally(() => {
          inFlight.current.delete(request);
        });
      inFlight.current.add(request);
    },
    [attemptId],
  );

  function queueSave(questionId: string, payload: AnswerPayload) {
    setStatuses((current) => ({ ...current, [questionId]: { state: "pending" } }));
    queued.current.set(questionId, payload);
    const existing = timers.current.get(questionId);
    if (existing) clearTimeout(existing);
    timers.current.set(
      questionId,
      setTimeout(() => runSave(questionId), AUTOSAVE_DEBOUNCE_MS),
    );
  }

  function choose(questionId: string, selected: string[]) {
    setAnswers((current) => ({ ...current, [questionId]: selected }));
    queueSave(questionId, { selectedOptionIds: selected });
  }

  function chooseText(questionId: string, value: string) {
    setTextAnswers((current) => ({ ...current, [questionId]: value }));
    queueSave(questionId, { textAnswer: value });
  }

  async function flushSaves() {
    for (const [questionId, timer] of timers.current) {
      clearTimeout(timer);
      runSave(questionId);
    }
    await Promise.allSettled([...inFlight.current]);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    void flushSaves().then(() => {
      startTransition(() => submitAction(formData));
    });
  }

  useEffect(() => {
    const mountedAt = Date.now();
    const interval = setInterval(() => {
      setRemaining(Math.max(0, remainingMs - (Date.now() - mountedAt)));
    }, 1000);
    return () => clearInterval(interval);
  }, [remainingMs]);

  useEffect(() => {
    if (remaining <= 0 && !autoSubmitted.current) {
      autoSubmitted.current = true;
      formRef.current?.requestSubmit();
    }
  }, [remaining]);

  useEffect(() => {
    const pendingTimers = timers.current;
    return () => {
      for (const timer of pendingTimers.values()) clearTimeout(timer);
    };
  }, []);

  const answeredCount = questions.filter((question) =>
    question.type === "short_answer"
      ? (textAnswers[question.id]?.trim().length ?? 0) > 0
      : (answers[question.id]?.length ?? 0) > 0,
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-background sticky top-0 z-10 flex items-center justify-between border-b py-3">
        <p className="text-muted-foreground text-sm">
          {answeredCount} of {questions.length} answered
        </p>
        <p
          className={`font-mono text-lg font-semibold ${remaining < 60_000 ? "text-destructive" : ""}`}
          aria-live="polite"
        >
          {remaining > 0 ? formatRemaining(remaining) : "Time's up"}
        </p>
      </div>

      {questions.map((question, index) => {
        const selected = answers[question.id] ?? [];
        const status = statuses[question.id];
        return (
          <Card key={question.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                <span>Question {index + 1}</span>
                <span className="text-muted-foreground text-xs font-normal">
                  {question.points} {question.points === 1 ? "point" : "points"} ·{" "}
                  {question.type === "single_choice"
                    ? "Choose one"
                    : question.type === "multiple_choice"
                      ? "Choose all that apply"
                      : "Type your answer"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {question.body}
              {question.type === "short_answer" ? (
                <Input
                  id={`${question.id}-text`}
                  aria-label="Your answer"
                  value={textAnswers[question.id] ?? ""}
                  disabled={remaining <= 0 || submitting}
                  onChange={(event) => chooseText(question.id, event.target.value)}
                />
              ) : question.type === "single_choice" ? (
                <RadioGroup
                  value={selected[0] ?? ""}
                  onValueChange={(value) => choose(question.id, [value])}
                  disabled={remaining <= 0 || submitting}
                >
                  {question.options.map((option) => (
                    <div key={option.id} className="flex items-center gap-2">
                      <RadioGroupItem
                        value={option.id}
                        id={`${question.id}-${option.id}`}
                      />
                      <Label
                        htmlFor={`${question.id}-${option.id}`}
                        className="font-normal"
                      >
                        {option.text}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              ) : (
                <div className="flex flex-col gap-3">
                  {question.options.map((option) => (
                    <div key={option.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`${question.id}-${option.id}`}
                        checked={selected.includes(option.id)}
                        disabled={remaining <= 0 || submitting}
                        onCheckedChange={(checked) =>
                          choose(
                            question.id,
                            checked === true
                              ? [...selected, option.id]
                              : selected.filter((id) => id !== option.id),
                          )
                        }
                      />
                      <Label
                        htmlFor={`${question.id}-${option.id}`}
                        className="font-normal"
                      >
                        {option.text}
                      </Label>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-muted-foreground min-h-4 text-xs" aria-live="polite">
                {status?.state === "pending" || status?.state === "saving"
                  ? "Saving…"
                  : status?.state === "saved"
                    ? "Saved"
                    : null}
                {status?.state === "error" ? (
                  <span className="text-destructive">{status.message}</span>
                ) : null}
              </p>
            </CardContent>
          </Card>
        );
      })}

      {/*
        No `action` prop here, deliberately: this form needs to flush
        pending autosaves before dispatching the submit action, and having
        both `action={submitAction}` and a manual `onSubmit` dispatch
        double-fires the same useActionState action — confirmed to hang
        the submission forever (caught by e2e/course-quiz-flow.spec.ts,
        the same bug fixed across course/lesson/quiz/question-form.tsx).
        onSubmit here is the only dispatch path.
      */}
      <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-2">
        <input type="hidden" name="attemptId" value={attemptId} />
        {submitState && "error" in submitState ? (
          <p className="text-destructive text-sm">{submitState.error}</p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          Your answers save automatically. Once submitted, they can no longer be changed.
        </p>
        <Button type="submit" disabled={submitting} className="self-start">
          {submitting ? "Submitting…" : "Submit attempt"}
        </Button>
      </form>
    </div>
  );
}
