import { parsePhoneNumberFromString } from "libphonenumber-js";
import { z } from "zod";

/**
 * Validation, normalization, and action parsing for the complainant details
 * collected in #10 (V6A) — full name, phone, optional email, and address.
 * Mirrors the shape of ../domain/enrolment.ts and ../domain/filing.ts: pure
 * functions, no I/O, no logging of the values they handle (#10 Part M).
 */

const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 120;
const ADDRESS_MIN_LENGTH = 10;
const ADDRESS_MAX_LENGTH = 500;
const DEFAULT_PHONE_COUNTRY = "IN";

// C0 controls (0x00-0x1F) and C1 controls (0x7F-0x9F). Horizontal
// whitespace (space, tab) and line breaks are excluded here — each field's
// own normalizer decides what to do with those before this check runs.
const CONTROL_CHARS_EXCEPT_WHITESPACE_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

// ---------------------------------------------------------------------------
// Full name (Part C)
// ---------------------------------------------------------------------------

export type NameValidationReason = "REQUIRED" | "INVALID_LENGTH" | "INVALID_CHARACTERS";

export interface NameValidationResult {
  valid: boolean;
  /** Internal only — never shown to the advocate (Part C/D). */
  reason?: NameValidationReason;
  normalized?: string;
}

/** Trims and collapses runs of horizontal whitespace to a single space. Preserves every other Unicode character, including Malayalam script, as-is. */
export function normalizePersonName(value: string): string {
  return value.trim().replace(/[ \t]+/g, " ");
}

/**
 * Required, 2-120 Unicode characters after trimming/collapsing horizontal
 * whitespace. Rejects control characters and line breaks (a name is single-
 * line) without restricting the character set to Latin letters — Malayalam
 * and any other valid Unicode name is accepted as-is (#10 Part C).
 */
export function validatePersonName(value: string): NameValidationResult {
  const normalized = normalizePersonName(value);

  if (!normalized) {
    return { valid: false, reason: "REQUIRED" };
  }

  if (/[\n\r]/.test(normalized) || CONTROL_CHARS_EXCEPT_WHITESPACE_RE.test(normalized)) {
    return { valid: false, reason: "INVALID_CHARACTERS" };
  }

  if (normalized.length < NAME_MIN_LENGTH || normalized.length > NAME_MAX_LENGTH) {
    return { valid: false, reason: "INVALID_LENGTH" };
  }

  return { valid: true, normalized };
}

// ---------------------------------------------------------------------------
// Phone number (Part C)
// ---------------------------------------------------------------------------

export type PhoneValidationReason = "REQUIRED" | "INVALID";

export interface PhoneValidationResult {
  valid: boolean;
  reason?: PhoneValidationReason;
  /** Trimmed, as typed — preserved separately from the normalized value. */
  original?: string;
  /** E.164 output, e.g. "+919876543210". Never marked/implied as verified. */
  normalized?: string;
}

// libphonenumber-js's parser will happily extract a valid number from
// arbitrary surrounding prose (e.g. "call me at 9876543210" parses as a
// valid Indian number) — it validates a *substring* it can find, not that
// the whole input IS a phone number. This charset gate runs first so only
// digits and the punctuation a real phone number is written with are ever
// handed to the parser; anything else (words, sentences) is rejected
// before parsing, regardless of what the library might extract from it.
const PHONE_CHARSET_RE = /^[0-9+\-\s()]+$/;

/**
 * Required. Accepts E.164 input directly, or a valid Indian local number
 * using default country IN (#10 Part C). Uses libphonenumber-js — a
 * maintained library — rather than a custom regex, and rejects anything
 * impossible or invalid for its inferred region.
 */
export function validatePhoneNumber(value: string): PhoneValidationResult {
  const original = value.trim();

  if (!original) {
    return { valid: false, reason: "REQUIRED" };
  }

  if (!PHONE_CHARSET_RE.test(original)) {
    return { valid: false, reason: "INVALID", original };
  }

  const parsed = parsePhoneNumberFromString(original, DEFAULT_PHONE_COUNTRY);
  if (!parsed || !parsed.isValid()) {
    return { valid: false, reason: "INVALID", original };
  }

  return { valid: true, original, normalized: parsed.number };
}

// ---------------------------------------------------------------------------
// Email (Part C)
// ---------------------------------------------------------------------------

export type EmailValidationReason = "INVALID";

export interface EmailValidationResult {
  valid: boolean;
  reason?: EmailValidationReason;
  /** `null` when skipped or omitted — a valid, storable outcome, distinct from an invalid one. */
  normalized: string | null;
}

// Exact skip commands only (#10 Part C) — "skip"/"Skip" matched case-
// insensitively (both are just the one English word), the Malayalam
// command matched literally (the script has no case). Never fuzzy-matched.
// Shared with #11's optional accused phone (../domain/accused.ts) — never
// forked into a second recognizer.
const SKIP_COMMANDS: ReadonlySet<string> = new Set(["skip", "ഒഴിവാക്കുക"]);

const emailSchema = z.string().trim().min(1).email();

/** Recognizes an exact Skip command (English or Malayalam) on an already-trimmed value. Exported for reuse wherever another optional field needs the same Skip recognition (#11 Part C). */
export function isSkipCommand(trimmed: string): boolean {
  return SKIP_COMMANDS.has(trimmed.toLowerCase()) || SKIP_COMMANDS.has(trimmed);
}

/**
 * Optional. An exact Skip command (English or Malayalam) produces a valid
 * result with `normalized: null`. Otherwise the trimmed value is validated
 * with Zod's `.email()`; the domain is lower-cased while the local part's
 * casing is preserved (#10 Part C).
 */
export function validateEmail(value: string): EmailValidationResult {
  const trimmed = value.trim();

  if (isSkipCommand(trimmed)) {
    return { valid: true, normalized: null };
  }

  const parsed = emailSchema.safeParse(trimmed);
  if (!parsed.success) {
    return { valid: false, reason: "INVALID", normalized: null };
  }

  const atIndex = parsed.data.lastIndexOf("@");
  const localPart = parsed.data.slice(0, atIndex);
  const domain = parsed.data.slice(atIndex + 1).toLowerCase();

  return { valid: true, normalized: `${localPart}@${domain}` };
}

// ---------------------------------------------------------------------------
// Address (Part C)
// ---------------------------------------------------------------------------

export type AddressValidationReason = "REQUIRED" | "INVALID_LENGTH" | "INVALID_CHARACTERS";

export interface AddressValidationResult {
  valid: boolean;
  reason?: AddressValidationReason;
  normalized?: string;
}

/** Trims, normalizes CRLF/CR line endings to LF, and collapses horizontal-whitespace runs on each line — meaningful line breaks are preserved. */
export function normalizeAddress(value: string): string {
  return value
    .trim()
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n");
}

/**
 * Required, 10-500 Unicode characters after normalization. Line breaks are
 * explicitly permitted (addresses are multiline); any other control
 * character is rejected (#10 Part C). Never split into street/city/state/
 * PIN sub-fields in this MVP.
 */
export function validateAddress(value: string): AddressValidationResult {
  const normalized = normalizeAddress(value);

  if (!normalized) {
    return { valid: false, reason: "REQUIRED" };
  }

  if (CONTROL_CHARS_EXCEPT_WHITESPACE_RE.test(normalized)) {
    return { valid: false, reason: "INVALID_CHARACTERS" };
  }

  if (normalized.length < ADDRESS_MIN_LENGTH || normalized.length > ADDRESS_MAX_LENGTH) {
    return { valid: false, reason: "INVALID_LENGTH" };
  }

  return { valid: true, normalized };
}

// ---------------------------------------------------------------------------
// Review-action and edit-field selection parsing (Parts A/I/J/L)
// ---------------------------------------------------------------------------

export type ComplainantConfirmAction = "complainant:confirm" | "complainant:edit" | "filing:save-exit";
export type ComplainantEditFieldAction =
  | "complainant:edit-name"
  | "complainant:edit-phone"
  | "complainant:edit-email"
  | "complainant:edit-address";

const CONFIRM_ACTIONS: ReadonlySet<string> = new Set(["complainant:confirm", "complainant:edit", "filing:save-exit"]);
const EDIT_FIELD_ACTIONS: ReadonlySet<string> = new Set([
  "complainant:edit-name",
  "complainant:edit-phone",
  "complainant:edit-email",
  "complainant:edit-address",
]);

// Numbers and exact localized titles, matching the plain-text fallback in
// Part L ("1. Confirm 2. Edit 3. Save and exit"). Matching is case-
// insensitive for Latin text; Malayalam script has no case.
const CONFIRM_TEXT_TO_ACTION: Record<string, ComplainantConfirmAction> = {
  "1": "complainant:confirm",
  confirm: "complainant:confirm",
  "സ്ഥിരീകരിക്കുക": "complainant:confirm",
  "2": "complainant:edit",
  edit: "complainant:edit",
  "എഡിറ്റ് ചെയ്യുക": "complainant:edit",
  "3": "filing:save-exit",
  "save and exit": "filing:save-exit",
  "സേവ് ചെയ്ത് പുറത്തുപോകുക": "filing:save-exit",
};

// Matching the plain-text fallback in Part L ("1. Full name 2. Phone number 3. Email 4. Address").
const EDIT_FIELD_TEXT_TO_ACTION: Record<string, ComplainantEditFieldAction> = {
  "1": "complainant:edit-name",
  "full name": "complainant:edit-name",
  "പൂർണ്ണ പേര്": "complainant:edit-name",
  "2": "complainant:edit-phone",
  "phone number": "complainant:edit-phone",
  "ഫോൺ നമ്പർ": "complainant:edit-phone",
  "3": "complainant:edit-email",
  email: "complainant:edit-email",
  "ഇമെയിൽ": "complainant:edit-email",
  "4": "complainant:edit-address",
  address: "complainant:edit-address",
  "വിലാസം": "complainant:edit-address",
};

/** Same shape as the other domain modules' selection input — kept local so this module has no dependency on their files. */
export interface ComplainantSelectionInput {
  buttonPayload?: string;
  buttonText?: string;
  listId?: string;
  listTitle?: string;
  body?: string;
}

function resolveStableId(input: ComplainantSelectionInput): string {
  return (input.buttonPayload || input.listId || "").trim();
}

function resolveTextCandidates(input: ComplainantSelectionInput): string[] {
  return [(input.body || "").trim().toLowerCase(), (input.buttonText || input.listTitle || "").trim().toLowerCase()];
}

/**
 * Resolves a recognized review-action (Confirm/Edit/Save and exit). A
 * supplied stable ID is authoritative — same rule as every other action
 * parser in this codebase: if present, it's either the action or `null`,
 * never a fallback into text matching.
 */
export function parseComplainantConfirmAction(input: ComplainantSelectionInput): ComplainantConfirmAction | null {
  const stableId = resolveStableId(input);
  if (stableId) {
    return CONFIRM_ACTIONS.has(stableId) ? (stableId as ComplainantConfirmAction) : null;
  }

  for (const candidate of resolveTextCandidates(input)) {
    if (candidate in CONFIRM_TEXT_TO_ACTION) {
      return CONFIRM_TEXT_TO_ACTION[candidate];
    }
  }
  return null;
}

/** Resolves a recognized edit-field selection, with the same stable-ID-authoritative rule as `parseComplainantConfirmAction`. */
export function parseComplainantEditFieldAction(input: ComplainantSelectionInput): ComplainantEditFieldAction | null {
  const stableId = resolveStableId(input);
  if (stableId) {
    return EDIT_FIELD_ACTIONS.has(stableId) ? (stableId as ComplainantEditFieldAction) : null;
  }

  for (const candidate of resolveTextCandidates(input)) {
    if (candidate in EDIT_FIELD_TEXT_TO_ACTION) {
      return EDIT_FIELD_TEXT_TO_ACTION[candidate];
    }
  }
  return null;
}
