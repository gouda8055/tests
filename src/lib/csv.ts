/**
 * Pure CSV read/write helpers — no `server-only`/env dependency, so these
 * are directly unit-testable (tests/unit/csv.test.ts). Shared by the bulk
 * question importer (src/lib/quizzes/actions.ts) and the gradebook
 * exporter (src/app/admin/courses/[courseId]/quizzes/[quizId]/export/route.ts).
 */

const FORMULA_TRIGGER_CHARS = new Set(["=", "+", "-", "@"]);

/**
 * SECURITY.md §5: "Strip formulas to prevent CSV injection (cells starting
 * with =, +, -, @)." A leading apostrophe makes Excel/Sheets render the
 * cell as literal text instead of evaluating it, without losing the
 * original content. Applied on both ends: to every cell on import (before
 * it's stored) and to every cell on export (even app-authored names/
 * titles), since either side could end up opened in a spreadsheet.
 */
export function stripFormulaPrefix(value: string): string {
  return FORMULA_TRIGGER_CHARS.has(value.charAt(0)) ? `'${value}` : value;
}

/** Quotes a field only when it needs it; doubles any embedded quotes. */
export function toCsvField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function toCsvRow(fields: string[]): string {
  return fields.map(toCsvField).join(",");
}

/**
 * Minimal RFC4180 parser: quoted fields (commas/newlines inside them),
 * `""` as an escaped quote. Caller enforces any size/row-count cap before
 * calling this — it has no limit of its own.
 */
export function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < raw.length) {
    const char = raw[i];

    if (inQuotes) {
      if (char === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
    } else if (char === ",") {
      endField();
      i += 1;
    } else if (char === "\r") {
      i += 1;
    } else if (char === "\n") {
      endRow();
      i += 1;
    } else {
      field += char;
      i += 1;
    }
  }

  // Trailing field/row, unless the input ended with a newline already
  // consumed above (field === "" and row is empty means nothing pending).
  if (field !== "" || row.length > 0) endRow();

  return rows;
}
