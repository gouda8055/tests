import { parseCsv, stripFormulaPrefix } from "@/lib/csv";
import { importedQuestionSchema } from "@/lib/validation/quizzes";

const MAX_DATA_ROWS = 500;
const MAX_OPTION_COLUMNS = 10;

export type ParsedImportQuestion = {
  questionText: string;
  points: number;
  options: { text: string; correct: boolean }[];
};

export type ImportParseResult =
  | { ok: true; questions: ParsedImportQuestion[] }
  | { ok: false; errors: string[] };

/**
 * Parses the bulk-import CSV format documented on the import page:
 * `question_text,points,option_1,option_2,...,correct_options`, 2-10
 * option columns (contiguous, 1-based), `correct_options` a `;`-separated
 * list of 1-based indices into whichever option columns are non-empty on
 * that row. `points` may be blank (defaults to 1). Question type is
 * inferred from the correct-option count (1 = single_choice, >1 =
 * multiple_choice) — there's no separate column for it.
 *
 * Returns every row's errors at once, line-numbered, rather than stopping
 * at the first — importQuestions() (src/lib/quizzes/actions.ts) rejects
 * the whole import on any error, so there's no partial-success state to
 * reason about.
 */
export function parseQuestionsCsv(raw: string): ImportParseResult {
  const rows = parseCsv(raw.trim());
  if (rows.length === 0) return { ok: false, errors: ["The CSV is empty."] };

  const header = rows[0] ?? [];
  const dataRows = rows.slice(1);
  const headerError = validateHeader(header);
  if (headerError) return { ok: false, errors: [headerError] };
  const optionCount = header.length - 3;

  if (dataRows.length === 0) {
    return { ok: false, errors: ["No data rows found below the header."] };
  }
  if (dataRows.length > MAX_DATA_ROWS) {
    return {
      ok: false,
      errors: [`Too many rows (${dataRows.length}); at most ${MAX_DATA_ROWS} per import.`],
    };
  }

  const errors: string[] = [];
  const questions: ParsedImportQuestion[] = [];

  dataRows.forEach((row, index) => {
    const lineNumber = index + 2; // 1-based; header is line 1
    const rowError = (message: string) => errors.push(`Line ${lineNumber}: ${message}`);

    if (row.length !== header.length) {
      rowError(`expected ${header.length} columns, got ${row.length}.`);
      return;
    }

    const questionText = stripFormulaPrefix((row[0] ?? "").trim());
    const pointsRaw = (row[1] ?? "").trim();
    const points = pointsRaw === "" ? 1 : Number(pointsRaw);
    const optionCells = row
      .slice(2, 2 + optionCount)
      .map((cell) => stripFormulaPrefix(cell.trim()));
    const correctRaw = (row[2 + optionCount] ?? "").trim();

    if (!Number.isFinite(points)) {
      rowError("points must be a number.");
      return;
    }

    const presentOptions = optionCells
      .map((text, i) => ({ text, position: i + 1 }))
      .filter((option) => option.text !== "");
    if (presentOptions.length < 2) {
      rowError("at least 2 non-empty options are required.");
      return;
    }

    const correctIndices = correctRaw
      .split(";")
      .map((value) => value.trim())
      .filter((value) => value !== "")
      .map(Number);
    if (correctIndices.length === 0 || correctIndices.some((n) => !Number.isInteger(n))) {
      rowError('correct_options must be one or more option numbers separated by ";".');
      return;
    }
    const presentPositions = new Set(presentOptions.map((option) => option.position));
    const invalidIndex = correctIndices.find((n) => !presentPositions.has(n));
    if (invalidIndex !== undefined) {
      rowError(
        `correct_options references option ${invalidIndex}, which is empty or doesn't exist.`,
      );
      return;
    }

    const correctSet = new Set(correctIndices);
    const candidate: ParsedImportQuestion = {
      questionText,
      points,
      options: presentOptions.map((option) => ({
        text: option.text,
        correct: correctSet.has(option.position),
      })),
    };

    const validated = importedQuestionSchema.safeParse(candidate);
    if (!validated.success) {
      rowError(validated.error.issues[0]?.message ?? "invalid row.");
      return;
    }

    questions.push(candidate);
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, questions };
}

function validateHeader(header: string[]): string | null {
  if (header.length < 4) {
    return "Header must have at least question_text, points, 2 option columns, and correct_options.";
  }
  if (header[0]?.trim() !== "question_text") return 'First column must be "question_text".';
  if (header[1]?.trim() !== "points") return 'Second column must be "points".';
  if (header[header.length - 1]?.trim() !== "correct_options") {
    return 'Last column must be "correct_options".';
  }

  const optionColumns = header.slice(2, -1);
  if (optionColumns.length > MAX_OPTION_COLUMNS) {
    return `At most ${MAX_OPTION_COLUMNS} option columns.`;
  }
  for (let i = 0; i < optionColumns.length; i += 1) {
    if (optionColumns[i]?.trim() !== `option_${i + 1}`) {
      return `Column ${i + 3} must be named "option_${i + 1}".`;
    }
  }
  return null;
}
