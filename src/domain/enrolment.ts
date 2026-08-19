/**
 * Enrolment-number format validation and normalization (#9 Parts C/G,
 * reused by #33 Part A's representative-enrolment-number field on the
 * Complainant screen). Never verifies a number with a Bar Council —
 * validation here is purely a format check.
 *
 * The confirm/edit/save-exit action parsing that used to live alongside
 * this (#9's own ADVOCATE_ENROLMENT_PENDING/CONFIRM gate) was retired by
 * the reference-parity fix that dropped that gate — see
 * filing-workflow.ts's handleFilingNoticeInput. This file keeps only the
 * generic validator, since complainant-workflow.ts still depends on it.
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
