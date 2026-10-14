"use client";

import { useActionState } from "react";

import type { QuizActionState } from "@/lib/quizzes/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const EXAMPLE_CSV = `question_text,points,option_1,option_2,option_3,option_4,correct_options
"What is 2 + 2?",1,3,4,5,,2
"Which are prime numbers?",2,2,3,4,9,1;2`;

type ImportAction = (
  state: QuizActionState,
  formData: FormData,
) => Promise<QuizActionState>;

/**
 * Field name (csvText) matches importQuestionsSchema in
 * src/lib/validation/quizzes.ts. Errors from parseQuestionsCsv() are
 * newline-joined, one per bad row — rendered as a list here rather than a
 * single line.
 */
export function ImportQuestionsForm({
  action,
  quizId,
}: {
  action: ImportAction;
  quizId: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const errorLines = state && "error" in state ? state.error.split("\n") : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="text-muted-foreground flex flex-col gap-2 text-sm">
        <p>
          Header row, then one question per row. 2-10 <code>option_N</code>{" "}
          columns; leave a cell blank to use fewer options than columns.{" "}
          <code>correct_options</code> is one or more option numbers
          separated by <code>;</code> (e.g. <code>1</code> or{" "}
          <code>1;3</code>). <code>points</code> may be blank (defaults to
          1).
        </p>
        <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">{EXAMPLE_CSV}</pre>
      </div>
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="quizId" value={quizId} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="csvText">CSV</Label>
          <Textarea
            id="csvText"
            name="csvText"
            required
            rows={12}
            className="font-mono text-xs"
            placeholder={EXAMPLE_CSV}
          />
        </div>
        {errorLines.length > 0 ? (
          <ul className="text-destructive list-inside list-disc text-sm">
            {errorLines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        ) : null}
        {state && "success" in state ? (
          <p className="text-sm text-green-700">{state.success}</p>
        ) : null}
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Importing…" : "Import questions"}
        </Button>
      </form>
    </div>
  );
}
