import { Markdown } from "@/components/shared/markdown";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type ReviewQuestion = {
  id: string;
  text: string;
  points: number;
  options: { id: string; text: string }[];
  selected: string[];
  /** null when the viewer may not see the answer key. */
  correct: string[] | null;
  explanation: string | null;
};

function isExactMatch(selected: string[], correct: string[]) {
  const a = new Set(selected);
  const b = new Set(correct);
  return a.size === b.size && [...a].every((id) => b.has(id));
}

/** Read-only, server-rendered review of an attempt's answers. */
export function AttemptReview({ questions }: { questions: ReviewQuestion[] }) {
  return (
    <div className="flex flex-col gap-4">
      {questions.map((question, index) => {
        const selected = new Set(question.selected);
        const correct = question.correct ? new Set(question.correct) : null;
        const earned =
          question.correct && isExactMatch(question.selected, question.correct)
            ? question.points
            : 0;
        return (
          <Card key={question.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                <span>Question {index + 1}</span>
                <span className="text-muted-foreground text-xs font-normal">
                  {correct ? `${earned} / ${question.points}` : `${question.points} pt`}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Markdown content={question.text} />
              <ul className="flex flex-col gap-2 text-sm">
                {question.options.map((option) => (
                  <li key={option.id} className="flex flex-wrap items-center gap-2">
                    <span>{option.text}</span>
                    {selected.has(option.id) ? (
                      <Badge variant="outline">selected</Badge>
                    ) : null}
                    {correct?.has(option.id) ? (
                      <Badge variant="success">correct</Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
              {question.selected.length === 0 ? (
                <p className="text-muted-foreground text-xs">Not answered.</p>
              ) : null}
              {question.explanation ? (
                <div className="bg-muted rounded-md p-3">
                  <p className="mb-1 text-xs font-medium">Explanation</p>
                  <Markdown content={question.explanation} />
                </div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
