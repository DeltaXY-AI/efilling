import { isSkipCommand, validatePhoneNumber } from "./complainant";

/**
 * Validation and action parsing specific to the accused party (#11 / V6B).
 * Full name, address, and phone-format validation are reused directly from
 * ../domain/complainant.ts (`validatePersonName`, `validateAddress`,
 * `validatePhoneNumber`) — never forked or reimplemented (#11 Part C). The
 * only genuinely new validation behaviour here is phone being *optional*
 * (Skip-able), which complainant's phone never is.
 */

export type AccusedPhoneValidationReason = "INVALID";

export interface AccusedPhoneValidationResult {
  valid: boolean;
  reason?: AccusedPhoneValidationReason;
  /** `null` when skipped/omitted — both phone columns are stored `null` together (#11 Part B/C). */
  original: string | null;
  normalized: string | null;
}

/**
 * Optional. An exact Skip command (English or Malayalam, same recognizer as
 * #10's email) produces a valid result with both fields `null`. Otherwise
 * delegates to #10's `validatePhoneNumber` for the actual format/charset/
 * libphonenumber-js validation — never a second phone validator.
 */
export function validateAccusedPhone(value: string): AccusedPhoneValidationResult {
  const trimmed = value.trim();

  if (isSkipCommand(trimmed)) {
    return { valid: true, original: null, normalized: null };
  }

  const result = validatePhoneNumber(trimmed);
  if (!result.valid || !result.normalized) {
    return { valid: false, reason: "INVALID", original: null, normalized: null };
  }

  return { valid: true, original: result.original ?? trimmed, normalized: result.normalized };
}

// ---------------------------------------------------------------------------
// Entity type (#33 Part B — inserted right before ACCUSED_CONFIRM)
// ---------------------------------------------------------------------------

export type EntityType = "INDIVIDUAL" | "PROPRIETOR" | "COMPANY";

const ENTITY_TYPE_ACTIONS: ReadonlySet<string> = new Set(["accused:entity-individual", "accused:entity-proprietor", "accused:entity-company"]);

const ENTITY_TYPE_ACTION_TO_VALUE: Record<string, EntityType> = {
  "accused:entity-individual": "INDIVIDUAL",
  "accused:entity-proprietor": "PROPRIETOR",
  "accused:entity-company": "COMPANY",
};

// Numbers and exact localized titles, matching the plain-text fallback
// ("1. Individual 2. Proprietor of a firm 3. Company/partnership").
const ENTITY_TYPE_TEXT_TO_ACTION: Record<string, string> = {
  "1": "accused:entity-individual",
  individual: "accused:entity-individual",
  "വ്യക്തി": "accused:entity-individual",
  "2": "accused:entity-proprietor",
  "proprietor of a firm": "accused:entity-proprietor",
  "സ്ഥാപനത്തിന്റെ ഉടമ": "accused:entity-proprietor",
  "3": "accused:entity-company",
  "company/partnership": "accused:entity-company",
  company: "accused:entity-company",
  "കമ്പനി/പങ്കാളിത്തം": "accused:entity-company",
};

/**
 * Resolves the entity-type select (individual / proprietor of a firm /
 * company-partnership) to its stored enum value, with the same stable-ID-
 * authoritative rule as every other action parser in this codebase.
 */
export function parseEntityTypeSelection(input: AccusedSelectionInput): EntityType | null {
  const stableId = resolveStableId(input);
  if (stableId) {
    return ENTITY_TYPE_ACTIONS.has(stableId) ? ENTITY_TYPE_ACTION_TO_VALUE[stableId] : null;
  }

  for (const candidate of resolveTextCandidates(input)) {
    if (candidate in ENTITY_TYPE_TEXT_TO_ACTION) {
      return ENTITY_TYPE_ACTION_TO_VALUE[ENTITY_TYPE_TEXT_TO_ACTION[candidate]];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Review-action and edit-field selection parsing (Parts A/H/I/K, #33 Part B)
// ---------------------------------------------------------------------------

export type AccusedConfirmAction = "accused:confirm" | "accused:edit" | "filing:save-exit";
export type AccusedEditFieldAction = "accused:edit-name" | "accused:edit-phone" | "accused:edit-address" | "accused:edit-entity-type";

const CONFIRM_ACTIONS: ReadonlySet<string> = new Set(["accused:confirm", "accused:edit", "filing:save-exit"]);
const EDIT_FIELD_ACTIONS: ReadonlySet<string> = new Set([
  "accused:edit-name",
  "accused:edit-phone",
  "accused:edit-address",
  "accused:edit-entity-type",
]);

// Numbers and exact localized titles, matching the plain-text fallback in
// Part K ("1. Confirm 2. Edit 3. Save and exit"). Matching is case-
// insensitive for Latin text; Malayalam script has no case.
const CONFIRM_TEXT_TO_ACTION: Record<string, AccusedConfirmAction> = {
  "1": "accused:confirm",
  confirm: "accused:confirm",
  "സ്ഥിരീകരിക്കുക": "accused:confirm",
  "2": "accused:edit",
  edit: "accused:edit",
  "എഡിറ്റ് ചെയ്യുക": "accused:edit",
  "3": "filing:save-exit",
  "save and exit": "filing:save-exit",
  "സേവ് ചെയ്ത് പുറത്തുപോകുക": "filing:save-exit",
};

// Matching the plain-text fallback ("1. Full/legal name 2. Phone number
// 3. Address 4. Entity type") — #33 Part B adds the 4th option.
const EDIT_FIELD_TEXT_TO_ACTION: Record<string, AccusedEditFieldAction> = {
  "1": "accused:edit-name",
  "full/legal name": "accused:edit-name",
  "full legal name": "accused:edit-name",
  "പൂർണ്ണ/നിയമപരമായ പേര്": "accused:edit-name",
  "2": "accused:edit-phone",
  "phone number": "accused:edit-phone",
  "ഫോൺ നമ്പർ": "accused:edit-phone",
  "3": "accused:edit-address",
  address: "accused:edit-address",
  "വിലാസം": "accused:edit-address",
  "4": "accused:edit-entity-type",
  "entity type": "accused:edit-entity-type",
  "സ്ഥാപന തരം": "accused:edit-entity-type",
};

/** Same shape as the other domain modules' selection input — kept local so this module has no dependency on their files. */
export interface AccusedSelectionInput {
  buttonPayload?: string;
  buttonText?: string;
  listId?: string;
  listTitle?: string;
  body?: string;
}

function resolveStableId(input: AccusedSelectionInput): string {
  return (input.buttonPayload || input.listId || "").trim();
}

function resolveTextCandidates(input: AccusedSelectionInput): string[] {
  return [(input.body || "").trim().toLowerCase(), (input.buttonText || input.listTitle || "").trim().toLowerCase()];
}

/**
 * Resolves a recognized review-action (Confirm/Edit/Save and exit). A
 * supplied stable ID is authoritative — same rule as every other action
 * parser in this codebase: if present, it's either the action or `null`,
 * never a fallback into text matching.
 */
export function parseAccusedConfirmAction(input: AccusedSelectionInput): AccusedConfirmAction | null {
  const stableId = resolveStableId(input);
  if (stableId) {
    return CONFIRM_ACTIONS.has(stableId) ? (stableId as AccusedConfirmAction) : null;
  }

  for (const candidate of resolveTextCandidates(input)) {
    if (candidate in CONFIRM_TEXT_TO_ACTION) {
      return CONFIRM_TEXT_TO_ACTION[candidate];
    }
  }
  return null;
}

/** Resolves a recognized edit-field selection, with the same stable-ID-authoritative rule as `parseAccusedConfirmAction`. */
export function parseAccusedEditFieldAction(input: AccusedSelectionInput): AccusedEditFieldAction | null {
  const stableId = resolveStableId(input);
  if (stableId) {
    return EDIT_FIELD_ACTIONS.has(stableId) ? (stableId as AccusedEditFieldAction) : null;
  }

  for (const candidate of resolveTextCandidates(input)) {
    if (candidate in EDIT_FIELD_TEXT_TO_ACTION) {
      return EDIT_FIELD_TEXT_TO_ACTION[candidate];
    }
  }
  return null;
}
