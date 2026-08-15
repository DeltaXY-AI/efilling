import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * Formats a stored E.164 value (e.g. "+919876543210") for human display
 * (e.g. "+91 98765 43210") — matching #10 Part F's summary example.
 * Storage always stays strict E.164 (#10 Part C); this is a display-only
 * reformat, re-derived every time rather than persisted as a separate
 * column. Falls back to the raw stored value if it somehow doesn't parse
 * (defensive only — every stored value already passed `validatePhoneNumber`
 * or `validateAccusedPhone`). Shared by complainant-sender.ts and
 * accused-sender.ts — never a second copy of this formatting.
 */
export function formatPhoneForDisplay(phoneNormalized: string): string {
  const parsed = parsePhoneNumberFromString(phoneNormalized);
  return parsed ? parsed.formatInternational() : phoneNormalized;
}
