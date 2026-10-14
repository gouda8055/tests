import { isQuestionCorrect } from "@/lib/quizzes/grading";
import { Markdown } from "@/components/shared/markdown";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type ReviewQuestion = {
  id: string;
  text: string;
  points: number;
  type: "single_choice" | "multiple_choice" | "short_answer";
  options: { id: string; text: string }[];
  selected: string[];
  submittedText: string | null;
  /** null when the viewer may not see the answer key. */
  correctOptionIds: string[] | null;
  correctTextAnswers: string[] | null;
  explanation: string | null;
};

/** Read-only, server-rendered review of an attempt's answers. */
export function AttemptReview({ questions }: { questions: ReviewQuestion[] }) {
  return (
    <div className="flex flex-col gap-4">
      {questions.map((question, index) => {
        const selected = new Set(question.selected);
        const keyVisible = question.correctOptionIds !== null || question.correctTextAnswers !== null;
        const earned =
          keyVisible &&
          isQuestionCorrect(
            question.type,
            {
              correctOptionIds: question.correctOptionIds,
              correctTextAnswers: question.correctTextAnswers,
            },
            { selectedOptionIds: question.selected, textAnswer: question.submittedText },
          )
            ? question.points
            : 0;
        const answered =
          question.type === "short_answer"
            ? Boolean(question.submittedText?.trim())
            : question.selected.length > 0;
        return (
          <Card key={question.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                <span>Question {index + 1}</span>
                <span className="text-muted-foreground text-xs font-normal">
                  {keyVisible ? `${earned} / ${question.points}` : `${question.points} pt`}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Markdown content={question.text} />
              {question.type === "short_answer" ? (
                <div className="flex flex-col gap-2 text-sm">
                  <p>
                    Your answer:{" "}
                    <span className="font-medium">{question.submittedText || "—"}</span>
                  </p>
                  {question.correctTextAnswers ? (
                    <p className="text-muted-foreground">
                      Accepted: {question.correctTextAnswers.join(", ")}
                    </p>
                  ) : null}
                </div>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {question.options.map((option) => (
                    <li key={option.id} className="flex flex-wrap items-center gap-2">
                      <span>{option.text}</span>
                      {selected.has(option.id) ? (
                        <Badge variant="outline">selected</Badge>
                      ) : null}
                      {question.correctOptionIds?.includes(option.id) ? (
                        <Badge variant="success">correct</Badge>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {!answered ? (
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
