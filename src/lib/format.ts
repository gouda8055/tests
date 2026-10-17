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

/** `null`/`0` paise formats as "Free" rather than "₹0.00" — a course with
 * no price set is free, not zero-priced. */
export function formatPrice(pricePaise: number | null, currency = "INR"): string {
  if (!pricePaise) return "Free";
  const formatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: pricePaise % 100 === 0 ? 0 : 2,
  });
  return formatter.format(pricePaise / 100);
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
