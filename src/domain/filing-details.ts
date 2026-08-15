/**
 * Validation, normalization, and action parsing for #33 (Prototype parity —
 * Phase 5) Parts C-F: cheque and notice particulars, the transaction
 * narrative, and court selection/review/declaration. No existing domain
 * module owned any of this — unlike Parts A/B, which extend
 * ../domain/complainant.ts and ../domain/accused.ts respectively. Pure
 * functions, no I/O, no logging of the values they handle, matching every
 * other domain module in this codebase.
 */

// ---------------------------------------------------------------------------
// Cheque number (Part C) — required short free text, not a phone/email, so
// no existing validator fits; kept intentionally permissive (cheque number
// formats vary by bank) rather than a bank-specific pattern.
// ---------------------------------------------------------------------------

export type ChequeNumberValidationReason = "REQUIRED" | "INVALID_LENGTH";

export interface ChequeNumberValidationResult {
  valid: boolean;
  reason?: ChequeNumberValidationReason;
  normalized?: string;
}

const CHEQUE_NUMBER_MIN_LENGTH = 1;
const CHEQUE_NUMBER_MAX_LENGTH = 40;

export function validateChequeNumber(value: string): ChequeNumberValidationResult {
  const normalized = value.trim().replace(/[ \t]+/g, " ");

  if (!normalized) {
    return { valid: false, reason: "REQUIRED" };
  }
  if (normalized.length < CHEQUE_NUMBER_MIN_LENGTH || normalized.length > CHEQUE_NUMBER_MAX_LENGTH) {
    return { valid: false, reason: "INVALID_LENGTH" };
  }
  return { valid: true, normalized };
}

// ---------------------------------------------------------------------------
// Dates (Part C) — cheque date, memo date, notice date, service date. All
// required. Accepts DD-MM-YYYY or DD/MM/YYYY (matching the prototype's own
// displayed date format, e.g. "12-03-2026"); stores normalized as
// "YYYY-MM-DD" for the `date` column. Rejects calendar-invalid dates (e.g.
// 30-02-2026) rather than silently clamping them.
// ---------------------------------------------------------------------------

export type FilingDateValidationReason = "REQUIRED" | "INVALID_FORMAT" | "INVALID_CALENDAR_DATE";

export interface FilingDateValidationResult {
  valid: boolean;
  reason?: FilingDateValidationReason;
  /** ISO "YYYY-MM-DD". */
  normalized?: string;
}

const DATE_RE = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/;

export function validateFilingDate(value: string): FilingDateValidationResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return { valid: false, reason: "REQUIRED" };
  }

  const match = DATE_RE.exec(trimmed);
  if (!match) {
    return { valid: false, reason: "INVALID_FORMAT" };
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  // Round-trips through Date.UTC and checks the components come back
  // unchanged — rejects e.g. 30-02-2026 (Date would otherwise silently
  // roll it over into March) without a hand-rolled days-per-month table.
  const asDate = new Date(Date.UTC(year, month - 1, day));
  if (asDate.getUTCFullYear() !== year || asDate.getUTCMonth() !== month - 1 || asDate.getUTCDate() !== day) {
    return { valid: false, reason: "INVALID_CALENDAR_DATE" };
  }

  const normalized = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  return { valid: true, normalized };
}

// ---------------------------------------------------------------------------
// Amount (Part C) — required. Stored as text (currency), never a float
// (Part C's own schema note). Accepts an optional "₹" prefix and Indian-
// style comma grouping (e.g. "₹4,50,000"); normalized strips both down to
// the plain digits (and an optional decimal part), e.g. "450000".
// ---------------------------------------------------------------------------

export type AmountValidationReason = "REQUIRED" | "INVALID";

export interface AmountValidationResult {
  valid: boolean;
  reason?: AmountValidationReason;
  normalized?: string;
}

export function validateFilingAmount(value: string): AmountValidationResult {
  const trimmed = value.trim().replace(/^₹\s*/, "").replace(/,/g, "");
  if (!trimmed) {
    return { valid: false, reason: "REQUIRED" };
  }

  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return { valid: false, reason: "INVALID" };
  }
  if (Number(trimmed) <= 0) {
    return { valid: false, reason: "INVALID" };
  }

  return { valid: true, normalized: trimmed };
}

// ---------------------------------------------------------------------------
// Bank and branch (Part C) — optional free text, Skip-able like #10's email.
// ---------------------------------------------------------------------------

export type BankBranchValidationReason = "INVALID_LENGTH";

export interface BankBranchValidationResult {
  valid: boolean;
  reason?: BankBranchValidationReason;
  /** `null` means skipped/omitted — a valid, storable outcome. */
  normalized: string | null;
}

const BANK_BRANCH_MAX_LENGTH = 200;
const SKIP_COMMANDS: ReadonlySet<string> = new Set(["skip", "ഒഴിവാക്കുക"]);

function isSkip(trimmed: string): boolean {
  return SKIP_COMMANDS.has(trimmed.toLowerCase()) || SKIP_COMMANDS.has(trimmed);
}

export function validateBankBranch(value: string): BankBranchValidationResult {
  const trimmed = value.trim().replace(/[ \t]+/g, " ");
  if (!trimmed || isSkip(trimmed)) {
    return { valid: true, normalized: null };
  }
  if (trimmed.length > BANK_BRANCH_MAX_LENGTH) {
    return { valid: false, reason: "INVALID_LENGTH", normalized: null };
  }
  return { valid: true, normalized: trimmed };
}

// ---------------------------------------------------------------------------
// Narrative / story (Part D) — optional free text (Part E's uploaded
// written account is the alternative, not an additional requirement).
// ---------------------------------------------------------------------------

export interface NarrativeValidationResult {
  valid: boolean;
  reason?: "INVALID_LENGTH";
  /** `null` means skipped/omitted. */
  normalized: string | null;
}

const NARRATIVE_MAX_LENGTH = 4000;

export function validateNarrative(value: string): NarrativeValidationResult {
  const trimmed = value
    .trim()
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n");
  if (!trimmed || isSkip(trimmed)) {
    return { valid: true, normalized: null };
  }
  if (trimmed.length > NARRATIVE_MAX_LENGTH) {
    return { valid: false, reason: "INVALID_LENGTH", normalized: null };
  }
  return { valid: true, normalized: trimmed };
}

// ---------------------------------------------------------------------------
// Selection input shape and stable-ID/text-fallback resolution — same shape
// as every other domain module's, kept local so this module has no
// dependency on their files.
// ---------------------------------------------------------------------------

export interface FilingDetailSelectionInput {
  buttonPayload?: string;
  buttonText?: string;
  listId?: string;
  listTitle?: string;
  body?: string;
}

function resolveStableId(input: FilingDetailSelectionInput): string {
  return (input.buttonPayload || input.listId || "").trim();
}

function resolveTextCandidates(input: FilingDetailSelectionInput): string[] {
  return [(input.body || "").trim().toLowerCase(), (input.buttonText || input.listTitle || "").trim().toLowerCase()];
}

// ---------------------------------------------------------------------------
// Return reason (Part C) — optional 4-option select.
// ---------------------------------------------------------------------------

export type FilingReturnReason = "funds" | "stop" | "acct" | "sign";

const RETURN_REASON_ACTIONS: ReadonlySet<string> = new Set([
  "filing:reason-funds",
  "filing:reason-stop",
  "filing:reason-acct",
  "filing:reason-sign",
]);

const RETURN_REASON_ACTION_TO_VALUE: Record<string, FilingReturnReason> = {
  "filing:reason-funds": "funds",
  "filing:reason-stop": "stop",
  "filing:reason-acct": "acct",
  "filing:reason-sign": "sign",
};

const RETURN_REASON_TEXT_TO_ACTION: Record<string, string> = {
  "1": "filing:reason-funds",
  "funds insufficient": "filing:reason-funds",
  "പര്യാപ്തമായ തുകയില്ല": "filing:reason-funds",
  "2": "filing:reason-stop",
  "payment stopped": "filing:reason-stop",
  "പേയ്‌മെന്റ് നിർത്തി": "filing:reason-stop",
  "3": "filing:reason-acct",
  "account closed": "filing:reason-acct",
  "അക്കൗണ്ട് അടച്ചു": "filing:reason-acct",
  "4": "filing:reason-sign",
  "signature differs": "filing:reason-sign",
  "ഒപ്പ് വ്യത്യാസം": "filing:reason-sign",
};

/** Optional field — an empty/Skip body resolves to `null` (valid, meaning "not answered"), distinct from an unrecognized selection. */
export function parseReturnReasonSelection(input: FilingDetailSelectionInput): FilingReturnReason | null {
  const stableId = resolveStableId(input);
  if (stableId) {
    return RETURN_REASON_ACTIONS.has(stableId) ? RETURN_REASON_ACTION_TO_VALUE[stableId] : null;
  }
  for (const candidate of resolveTextCandidates(input)) {
    if (candidate in RETURN_REASON_TEXT_TO_ACTION) {
      return RETURN_REASON_ACTION_TO_VALUE[RETURN_REASON_TEXT_TO_ACTION[candidate]];
    }
  }
  return null;
}

export function isSkipSelection(input: FilingDetailSelectionInput): boolean {
  const body = (input.body || "").trim();
  return !body || isSkip(body);
}

// ---------------------------------------------------------------------------
// Paid after notice? (Part C) — required 2-option radio.
// ---------------------------------------------------------------------------

const PART_PAYMENT_ACTIONS: ReadonlySet<string> = new Set(["filing:paid-no", "filing:paid-part"]);
const PART_PAYMENT_ACTION_TO_VALUE: Record<string, boolean> = { "filing:paid-no": false, "filing:paid-part": true };
const PART_PAYMENT_TEXT_TO_ACTION: Record<string, string> = {
  "1": "filing:paid-no",
  "no, nothing paid": "filing:paid-no",
  "ഒന്നും അടച്ചിട്ടില്ല": "filing:paid-no",
  "2": "filing:paid-part",
  "part payment received": "filing:paid-part",
  "ഭാഗിക പേയ്‌മെന്റ് ലഭിച്ചു": "filing:paid-part",
};

export function parsePartPaymentSelection(input: FilingDetailSelectionInput): boolean | null {
  const stableId = resolveStableId(input);
  if (stableId) {
    return PART_PAYMENT_ACTIONS.has(stableId) ? PART_PAYMENT_ACTION_TO_VALUE[stableId] : null;
  }
  for (const candidate of resolveTextCandidates(input)) {
    if (candidate in PART_PAYMENT_TEXT_TO_ACTION) {
      return PART_PAYMENT_ACTION_TO_VALUE[PART_PAYMENT_TEXT_TO_ACTION[candidate]];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Witness (Part D) — required 2-option radio.
// ---------------------------------------------------------------------------

const WITNESS_ACTIONS: ReadonlySet<string> = new Set(["filing:witness-no", "filing:witness-yes"]);
const WITNESS_ACTION_TO_VALUE: Record<string, boolean> = { "filing:witness-no": false, "filing:witness-yes": true };
const WITNESS_TEXT_TO_ACTION: Record<string, string> = {
  "1": "filing:witness-no",
  "no one else": "filing:witness-no",
  "മറ്റാരും ഇല്ല": "filing:witness-no",
  "2": "filing:witness-yes",
  "someone was present": "filing:witness-yes",
  "ആരെങ്കിലും ഉണ്ടായിരുന്നു": "filing:witness-yes",
};

export function parseWitnessSelection(input: FilingDetailSelectionInput): boolean | null {
  const stableId = resolveStableId(input);
  if (stableId) {
    return WITNESS_ACTIONS.has(stableId) ? WITNESS_ACTION_TO_VALUE[stableId] : null;
  }
  for (const candidate of resolveTextCandidates(input)) {
    if (candidate in WITNESS_TEXT_TO_ACTION) {
      return WITNESS_ACTION_TO_VALUE[WITNESS_TEXT_TO_ACTION[candidate]];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Court (Part F) — hardcoded 3-option select (Scope decisions: confirmed
// hardcoded for the pilot, not data-driven). Stored as the exact label.
// ---------------------------------------------------------------------------

export const COURT_OPTIONS = ["ON Court - I, Kollam", "ON Court - II, Kollam", "JFCM, Kottarakkara"] as const;
export type CourtOption = (typeof COURT_OPTIONS)[number];

const COURT_ACTIONS: ReadonlySet<string> = new Set(["filing:court-1", "filing:court-2", "filing:court-3"]);
const COURT_ACTION_TO_VALUE: Record<string, CourtOption> = {
  "filing:court-1": COURT_OPTIONS[0],
  "filing:court-2": COURT_OPTIONS[1],
  "filing:court-3": COURT_OPTIONS[2],
};
const COURT_TEXT_TO_ACTION: Record<string, string> = {
  "1": "filing:court-1",
  "on court - i, kollam": "filing:court-1",
  "2": "filing:court-2",
  "on court - ii, kollam": "filing:court-2",
  "3": "filing:court-3",
  "jfcm, kottarakkara": "filing:court-3",
};

export function parseCourtSelection(input: FilingDetailSelectionInput): CourtOption | null {
  const stableId = resolveStableId(input);
  if (stableId) {
    return COURT_ACTIONS.has(stableId) ? COURT_ACTION_TO_VALUE[stableId] : null;
  }
  for (const candidate of resolveTextCandidates(input)) {
    if (candidate in COURT_TEXT_TO_ACTION) {
      return COURT_ACTION_TO_VALUE[COURT_TEXT_TO_ACTION[candidate]];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Review action (Part F) — mirrors #10/#11's Confirm/Edit/Save and exit.
// ---------------------------------------------------------------------------

export type FilingReviewAction = "filing:confirm" | "filing:edit" | "filing:save-exit";

const REVIEW_ACTIONS: ReadonlySet<string> = new Set(["filing:confirm", "filing:edit", "filing:save-exit"]);
const REVIEW_TEXT_TO_ACTION: Record<string, FilingReviewAction> = {
  "1": "filing:confirm",
  confirm: "filing:confirm",
  "സ്ഥിരീകരിക്കുക": "filing:confirm",
  "2": "filing:edit",
  edit: "filing:edit",
  "എഡിറ്റ് ചെയ്യുക": "filing:edit",
  "3": "filing:save-exit",
  "save and exit": "filing:save-exit",
  "സേവ് ചെയ്ത് പുറത്തുപോകുക": "filing:save-exit",
};

export function parseFilingReviewAction(input: FilingDetailSelectionInput): FilingReviewAction | null {
  const stableId = resolveStableId(input);
  if (stableId) {
    return REVIEW_ACTIONS.has(stableId) ? (stableId as FilingReviewAction) : null;
  }
  for (const candidate of resolveTextCandidates(input)) {
    if (candidate in REVIEW_TEXT_TO_ACTION) {
      return REVIEW_TEXT_TO_ACTION[candidate];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Edit-group + edit-field selection (Part F review's edit picker). Only
// Parts C/D/F's own fields are editable from this review — Parts A/B
// already have their own dedicated review/edit loop (#10/#11) at their own
// point in the flow, not re-litigated here. WhatsApp's list-picker caps at
// 10 rows, and Part C alone is 9 fields, so editing is a 2-level pick:
// first a group (Cheque & notice / Story, witness & court), then the field
// within it.
// ---------------------------------------------------------------------------

export type FilingEditGroup = "cheque" | "narrative";

const EDIT_GROUP_ACTIONS: ReadonlySet<string> = new Set(["filing:edit-group-cheque", "filing:edit-group-narrative"]);
const EDIT_GROUP_ACTION_TO_VALUE: Record<string, FilingEditGroup> = {
  "filing:edit-group-cheque": "cheque",
  "filing:edit-group-narrative": "narrative",
};
const EDIT_GROUP_TEXT_TO_ACTION: Record<string, string> = {
  "1": "filing:edit-group-cheque",
  "cheque & notice": "filing:edit-group-cheque",
  "cheque and notice": "filing:edit-group-cheque",
  "2": "filing:edit-group-narrative",
  "story, witness & court": "filing:edit-group-narrative",
  "story, witness and court": "filing:edit-group-narrative",
};

export function parseFilingEditGroupSelection(input: FilingDetailSelectionInput): FilingEditGroup | null {
  const stableId = resolveStableId(input);
  if (stableId) {
    return EDIT_GROUP_ACTIONS.has(stableId) ? EDIT_GROUP_ACTION_TO_VALUE[stableId] : null;
  }
  for (const candidate of resolveTextCandidates(input)) {
    if (candidate in EDIT_GROUP_TEXT_TO_ACTION) {
      return EDIT_GROUP_ACTION_TO_VALUE[EDIT_GROUP_TEXT_TO_ACTION[candidate]];
    }
  }
  return null;
}

// Values match filing-details-workflow.ts's TextFieldKey names exactly
// (plus "returnReason"/"partPayment", the group's 2 selection-based
// fields) so filing-review-workflow.ts's edit dispatch needs no separate
// translation table between "what was selected" and "which field/state".
export type FilingChequeEditField =
  | "chequeNumber"
  | "chequeDate"
  | "amount"
  | "bankBranch"
  | "returnReason"
  | "memoDate"
  | "noticeDate"
  | "serviceDate"
  | "partPayment";

const CHEQUE_FIELD_ACTIONS: ReadonlySet<string> = new Set([
  "filing:edit-cheque-number",
  "filing:edit-cheque-date",
  "filing:edit-amount",
  "filing:edit-bank-branch",
  "filing:edit-return-reason",
  "filing:edit-memo-date",
  "filing:edit-notice-date",
  "filing:edit-service-date",
  "filing:edit-part-payment",
]);

const CHEQUE_FIELD_ACTION_TO_VALUE: Record<string, FilingChequeEditField> = {
  "filing:edit-cheque-number": "chequeNumber",
  "filing:edit-cheque-date": "chequeDate",
  "filing:edit-amount": "amount",
  "filing:edit-bank-branch": "bankBranch",
  "filing:edit-return-reason": "returnReason",
  "filing:edit-memo-date": "memoDate",
  "filing:edit-notice-date": "noticeDate",
  "filing:edit-service-date": "serviceDate",
  "filing:edit-part-payment": "partPayment",
};

export function parseFilingChequeEditFieldSelection(input: FilingDetailSelectionInput): FilingChequeEditField | null {
  const stableId = resolveStableId(input);
  return stableId && CHEQUE_FIELD_ACTIONS.has(stableId) ? CHEQUE_FIELD_ACTION_TO_VALUE[stableId] : null;
}

export type FilingNarrativeEditField = "story" | "witness" | "court";

const NARRATIVE_FIELD_ACTIONS: ReadonlySet<string> = new Set(["filing:edit-story", "filing:edit-witness", "filing:edit-court"]);
const NARRATIVE_FIELD_ACTION_TO_VALUE: Record<string, FilingNarrativeEditField> = {
  "filing:edit-story": "story",
  "filing:edit-witness": "witness",
  "filing:edit-court": "court",
};

export function parseFilingNarrativeEditFieldSelection(input: FilingDetailSelectionInput): FilingNarrativeEditField | null {
  const stableId = resolveStableId(input);
  return stableId && NARRATIVE_FIELD_ACTIONS.has(stableId) ? NARRATIVE_FIELD_ACTION_TO_VALUE[stableId] : null;
}

// ---------------------------------------------------------------------------
// Declaration (Part F) — a single-action accept, no "decline" path (per
// this issue: "declare checkbox... before advancing to Phase 6" — there is
// nowhere else to go from this screen except accepting it, save-and-exit
// aside, mirrored by every other confirm screen in this codebase).
// ---------------------------------------------------------------------------

export type FilingDeclareAction = "filing:declare-accept" | "filing:save-exit";

const DECLARE_ACTIONS: ReadonlySet<string> = new Set(["filing:declare-accept", "filing:save-exit"]);
const DECLARE_TEXT_TO_ACTION: Record<string, FilingDeclareAction> = {
  "1": "filing:declare-accept",
  "i declare": "filing:declare-accept",
  declare: "filing:declare-accept",
  "ഞാൻ പ്രഖ്യാപിക്കുന്നു": "filing:declare-accept",
  "2": "filing:save-exit",
  "save and exit": "filing:save-exit",
  "സേവ് ചെയ്ത് പുറത്തുപോകുക": "filing:save-exit",
};

export function parseFilingDeclareAction(input: FilingDetailSelectionInput): FilingDeclareAction | null {
  const stableId = resolveStableId(input);
  if (stableId) {
    return DECLARE_ACTIONS.has(stableId) ? (stableId as FilingDeclareAction) : null;
  }
  for (const candidate of resolveTextCandidates(input)) {
    if (candidate in DECLARE_TEXT_TO_ACTION) {
      return DECLARE_TEXT_TO_ACTION[candidate];
    }
  }
  return null;
}
