/**
 * Advocate enrolment number validation, normalization, and confirmation
 * action parsing (#9 Parts C/G/H/I). This slice never verifies a number
 * with a Bar Council — validation here is purely a format check.
 */

export type EnrolmentValidationReason = "REQUIRED" | "INVALID_LENGTH" | "INVALID_CHARACTERS" | "DIGIT_REQUIRED";

export interface EnrolmentValidationResult {
  valid: boolean;
  original: string;
  normalized?: string;
  /** Internal only — never shown to the advocate (Part C). */
  reason?: EnrolmentValidationReason;
}

const MIN_LENGTH = 5;
const MAX_LENGTH = 30;
// Latin letters, digits, spaces, "/" and "-" only (Part C).
const ALLOWED_CHARACTERS_RE = /^[A-Za-z0-9 /-]+$/;
const ALPHANUMERIC_RE = /^[A-Za-z0-9]$/;
const HAS_DIGIT_RE = /\d/;

/**
 * Uppercases and removes whitespace immediately around "/" and "-", while
 * collapsing any other run of whitespace to a single space. Exact
 * normalization given by #9 Part C — not reimplemented differently
 * elsewhere.
 */
export function normalizeEnrolmentNumber(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s*([/-])\s*/g, "$1")
    .replace(/\s+/g, " ");
}

/**
 * Validates a typed enrolment number against #9 Part C's format rules —
 * required, 5-30 characters after trimming, a restricted charset, at least
 * one digit, and must begin/end with a letter or number. Accepts a range
 * of realistic formats (`K/1234/2010`, `KER-1234-2010`, `1234/2010`, ...)
 * without enforcing one state-specific pattern. Never attempts external or
 * Bar Council verification. The trimmed original input and the separately
 * normalized value are both preserved — never conflated.
 */
export function validateEnrolmentNumber(value: string): EnrolmentValidationResult {
  const original = value.trim();

  if (!original) {
    return { valid: false, original, reason: "REQUIRED" };
  }

  if (original.length < MIN_LENGTH || original.length > MAX_LENGTH) {
    return { valid: false, original, reason: "INVALID_LENGTH" };
  }

  if (!ALLOWED_CHARACTERS_RE.test(original)) {
    return { valid: false, original, reason: "INVALID_CHARACTERS" };
  }

  const first = original[0];
  const last = original[original.length - 1];
  if (!ALPHANUMERIC_RE.test(first) || !ALPHANUMERIC_RE.test(last)) {
    return { valid: false, original, reason: "INVALID_CHARACTERS" };
  }

  if (!HAS_DIGIT_RE.test(original)) {
    return { valid: false, original, reason: "DIGIT_REQUIRED" };
  }

  return { valid: true, original, normalized: normalizeEnrolmentNumber(original) };
}

export type EnrolmentConfirmAction = "enrolment:confirm" | "enrolment:edit" | "filing:save-exit";

const CONFIRM_ACTIONS: ReadonlySet<string> = new Set(["enrolment:confirm", "enrolment:edit", "filing:save-exit"]);

// Numbers and exact localized titles, matching the fallback numbered list
// in #9 Part J ("1. Confirm  2. Edit  3. Save and exit"). Matching is
// case-insensitive for Latin text; Malayalam script has no case.
const CONFIRM_TEXT_TO_ACTION: Record<string, EnrolmentConfirmAction> = {
  "1": "enrolment:confirm",
  confirm: "enrolment:confirm",
  "സ്ഥിരീകരിക്കുക": "enrolment:confirm",
  "2": "enrolment:edit",
  edit: "enrolment:edit",
  "എഡിറ്റ് ചെയ്യുക": "enrolment:edit",
  "3": "filing:save-exit",
  "save and exit": "filing:save-exit",
  "സേവ് ചെയ്ത് പുറത്തുപോകുക": "filing:save-exit",
};

/** Same shape as filing-domain's FilingSelectionInput — kept local so this module has no dependency on #8's file. */
export interface EnrolmentSelectionInput {
  buttonPayload?: string;
  buttonText?: string;
  body?: string;
}

function resolveStableId(input: EnrolmentSelectionInput): string {
  return (input.buttonPayload || "").trim();
}

function resolveTextCandidates(input: EnrolmentSelectionInput): string[] {
  return [(input.body || "").trim().toLowerCase(), (input.buttonText || "").trim().toLowerCase()];
}

/**
 * Resolves a recognized enrolment-confirmation action. A supplied stable
 * ID is authoritative — same rule as #8's parseDraftChoiceAction: if
 * present, it's either the action or `null`, never a fallback into text
 * matching. Text fallbacks (numbered/localized title) only apply when no
 * button interaction was supplied at all — this is what the Part J plain-
 * text fallback ("1. Confirm 2. Edit 3. Save and exit") relies on.
 */
export function parseEnrolmentConfirmAction(input: EnrolmentSelectionInput): EnrolmentConfirmAction | null {
  const stableId = resolveStableId(input);
  if (stableId) {
    return CONFIRM_ACTIONS.has(stableId) ? (stableId as EnrolmentConfirmAction) : null;
  }

  for (const candidate of resolveTextCandidates(input)) {
    if (candidate in CONFIRM_TEXT_TO_ACTION) {
      return CONFIRM_TEXT_TO_ACTION[candidate];
    }
  }
  return null;
}
