import { describe, expect, it } from "vitest";

import { parseCsv, stripFormulaPrefix, toCsvField, toCsvRow } from "@/lib/csv";

describe("stripFormulaPrefix", () => {
  it.each(["=SUM(A1)", "+1", "-1", "@cmd"])(
    "prefixes a leading apostrophe when a cell starts with %s",
    (value) => {
      expect(stripFormulaPrefix(value)).toBe(`'${value}`);
    },
  );

  it("leaves an ordinary cell untouched", () => {
    expect(stripFormulaPrefix("Alice Smith")).toBe("Alice Smith");
    expect(stripFormulaPrefix("")).toBe("");
  });
});

describe("toCsvField / toCsvRow", () => {
  it("leaves a plain field unquoted", () => {
    expect(toCsvField("hello")).toBe("hello");
  });

  it("quotes a field containing a comma", () => {
    expect(toCsvField("a,b")).toBe('"a,b"');
  });

  it("quotes and doubles embedded quotes", () => {
    expect(toCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes a field containing a newline", () => {
    expect(toCsvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("joins fields with commas", () => {
    expect(toCsvRow(["a", "b,c", 'd"e'])).toBe('a,"b,c","d""e"');
  });
});

describe("parseCsv", () => {
  it("parses a simple multi-row CSV", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("round-trips a quoted field containing a comma and an escaped quote", () => {
    const written = toCsvRow(["plain", 'has "quotes" and, a comma']);
    expect(parseCsv(written)).toEqual([["plain", 'has "quotes" and, a comma']]);
  });

  it("handles an embedded newline inside a quoted field", () => {
    const written = toCsvRow(["line one\nline two", "next"]);
    expect(parseCsv(written)).toEqual([["line one\nline two", "next"]]);
  });

  it("tolerates a trailing newline without producing a phantom empty row", () => {
    expect(parseCsv("a,b\nc,d\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("strips carriage returns from CRLF line endings", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});
