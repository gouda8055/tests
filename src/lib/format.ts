const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** Server-rendered timestamps (rendered in the server's time zone). */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return dateTimeFormat.format(new Date(value));
}

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

export function formatScore(score: unknown, maxScore: unknown): string {
  if (
    score === null ||
    score === undefined ||
    maxScore === null ||
    maxScore === undefined
  ) {
    return "—";
  }
  return `${Number(score)} / ${Number(maxScore)}`;
}
