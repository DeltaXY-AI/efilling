/**
 * Shared IST (Asia/Kolkata — the courts this pilot serves are in Kerala)
 * date/timestamp formatting for user-facing messages. Extracted out of
 * filing-completion-sender.ts (#35) once filing-draft-list-sender.ts (#36)
 * needed the exact same "DD-MM-YYYY" shape, rather than a second copy.
 */

function isoDateParts(isoDate: string): { year: number; month: number; day: number } {
  const [year, month, day] = isoDate.split("-").map(Number);
  return { year, month, day };
}

/** "DD-MM-YYYY, h:mm AM/PM", matching the prototype's own timestamp style (PR.md Appendix A.8, e.g. "20-04-2026, 9:41 AM"). */
export function formatIstTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")}, ${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`;
}

/** "DD-MM-YYYY" — a date with no time component, for a plain calendar date already stored as a "YYYY-MM-DD" string (e.g. serviceDate) rather than a Date/timestamptz. */
export function formatIsoDateAsDisplay(isoDate: string): string {
  const { year, month, day } = isoDateParts(isoDate);
  return `${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}-${year}`;
}
