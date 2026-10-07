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

type QuestionFormAction = (
  state: QuizActionState,
  formData: FormData,
) => Promise<QuizActionState>;

export type QuestionFormValues = {
  id: string;
  questionText: string;
  questionType: "single_choice" | "multiple_choice";
  points: number;
  explanation: string | null;
  options: { id: string; text: string; correct: boolean }[];
};

const NEW_OPTION_SLOTS_CREATE = 6;
const NEW_OPTION_SLOTS_EDIT = 2;

/**
 * Create (pass quizId) or edit (pass question) a question with its options
 * and correct answer(s). Field names match the shapes documented on
 * createQuestion/updateQuestion in src/lib/quizzes/actions.ts.
 */
export function QuestionForm({
  action,
  quizId,
  question,
}: {
  action: QuestionFormAction;
  quizId?: string;
  question?: QuestionFormValues;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const newSlots = question ? NEW_OPTION_SLOTS_EDIT : NEW_OPTION_SLOTS_CREATE;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {question ? <input type="hidden" name="questionId" value={question.id} /> : null}
      {!question && quizId ? <input type="hidden" name="quizId" value={quizId} /> : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="questionText">Question (Markdown)</Label>
        <Textarea
          id="questionText"
          name="questionText"
          rows={5}
          required
          maxLength={10000}
          defaultValue={question?.questionText}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="questionType">Type</Label>
          <Select
            name="questionType"
            defaultValue={question?.questionType ?? "single_choice"}
          >
            <SelectTrigger id="questionType">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="single_choice">Single choice (one correct)</SelectItem>
              <SelectItem value="multiple_choice">
                Multiple choice (all that apply)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="questionPoints">Points</Label>
          <Input
            id="questionPoints"
            name="points"
            type="number"
            min={0.5}
            max={1000}
            step={0.5}
            required
            defaultValue={question?.points ?? 1}
          />
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">
          Options — tick the correct answer(s)
        </legend>
        {question?.options.map((option, index) => (
          <div key={option.id} className="flex items-center gap-2">
            <input type="hidden" name="existingOptionId" value={option.id} />
            <Checkbox
              name="correctExisting"
              value={option.id}
              defaultChecked={option.correct}
              aria-label={`Option ${index + 1} is correct`}
            />
            <Input
              name="existingOptionText"
              type="text"
              required
              maxLength={1000}
              defaultValue={option.text}
              aria-label={`Option ${index + 1}`}
            />
          </div>
        ))}
        {Array.from({ length: newSlots }, (_, slot) => {
          const number = (question?.options.length ?? 0) + slot + 1;
          return (
            <div key={`new-${slot}`} className="flex items-center gap-2">
              <Checkbox
                name={question ? "correctNew" : "correct"}
                value={String(slot)}
                aria-label={`Option ${number} is correct`}
              />
              <Input
                name={question ? "newOptionText" : "optionText"}
                type="text"
                maxLength={1000}
                placeholder={question ? "Add an option (optional)" : `Option ${number}`}
                aria-label={`Option ${number}`}
              />
            </div>
          );
        })}
        <p className="text-muted-foreground text-xs">
          {question
            ? "Existing options can be edited but not removed (it would disturb attempts already in progress)."
            : "Blank options are ignored. At least 2 are required."}
        </p>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="questionExplanation">Explanation (optional)</Label>
        <Textarea
          id="questionExplanation"
          name="explanation"
          rows={3}
          maxLength={10000}
          defaultValue={question?.explanation ?? ""}
        />
        <p className="text-muted-foreground text-xs">
          Shown to students after submitting only if the quiz allows reviewing answers.
        </p>
      </div>

      {state && "error" in state ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      {state && "success" in state ? (
        <p className="text-sm text-green-700">{state.success}</p>
      ) : null}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : question ? "Save question" : "Add question"}
      </Button>
    </form>
  );
}
