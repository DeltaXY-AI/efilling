export type LanguageCode = "en" | "ml";

// Stable button payloads first, then the documented text fallbacks. Matching
// is case-insensitive for Latin text; Malayalam script has no case, so
// lower-casing it is a no-op and safe to include in the same set.
const ENGLISH_VALUES = new Set(["language:en", "english", "1"]);
const MALAYALAM_VALUES = new Set(["language:ml", "malayalam", "മലയാളം", "2"]);
const LANGUAGE_CHANGE_TRIGGERS = new Set(["language", "ഭാഷ"]);

export interface SelectionInput {
  buttonPayload?: string;
  buttonText?: string;
  body?: string;
}

function candidateValue(input: SelectionInput): string {
  return (input.buttonPayload || input.buttonText || input.body || "").trim().toLowerCase();
}

/**
 * Parses a recognized language selection from a Twilio Quick Reply payload
 * or its documented text/number fallbacks. Returns `null` for anything
 * unrecognized — never fuzzy-matched, since this drives a state transition.
 */
export function parseLanguageSelection(input: SelectionInput): LanguageCode | null {
  const candidate = candidateValue(input);

  if (ENGLISH_VALUES.has(candidate)) {
    return "en";
  }
  if (MALAYALAM_VALUES.has(candidate)) {
    return "ml";
  }
  return null;
}

/** True when the advocate explicitly asked to change language ("language" / "ഭാഷ"). */
export function isLanguageChangeRequest(input: SelectionInput): boolean {
  return LANGUAGE_CHANGE_TRIGGERS.has(candidateValue(input));
}
