/**
 * Validation and action parsing for #37 (Prototype parity — Phase 9): the
 * scrutiny-defect correction flow. Pure functions, no I/O, no logging of the
 * values they handle, matching every other domain module in this codebase.
 *
 * Scope decision (confirmed): this is the Kollam/ON-Court demo's fixed,
 * simulated defect scenario (cheque-number mismatch, illegible photo,
 * time-barred correction) pushed to the advocate on request — there is no
 * real Scrutiny Officer role. Defect 1's corrected cheque number is the one
 * genuinely-collected value; callers reuse `validateChequeNumber` directly
 * from ../domain/filing-details.ts, never a second implementation.
 */

// ---------------------------------------------------------------------------
// FILING_DEFECT_ALERT: the one available action, starting the correction flow.
// ---------------------------------------------------------------------------

export type DefectAlertAction = "filing:correct-defects";

const DEFECT_ALERT_ACTIONS: ReadonlySet<string> = new Set(["filing:correct-defects"]);

const DEFECT_ALERT_TEXT_TO_ACTION: Record<string, DefectAlertAction> = {
  "1": "filing:correct-defects",
  "correct the defects": "filing:correct-defects",
  "ന്യൂനതകൾ തിരുത്തുക": "filing:correct-defects",
};

/** Same shape as every other domain module's selection input — kept local so this module has no dependency on their files. */
export interface DefectSelectionInput {
  buttonPayload?: string;
  buttonText?: string;
  body?: string;
}

function resolveStableId(input: DefectSelectionInput): string {
  return (input.buttonPayload || "").trim();
}

function resolveTextCandidates(input: DefectSelectionInput): string[] {
  return [(input.body || "").trim().toLowerCase(), (input.buttonText || "").trim().toLowerCase()];
}

export function parseDefectAlertAction(input: DefectSelectionInput): DefectAlertAction | null {
  const stableId = resolveStableId(input);
  if (stableId) {
    return DEFECT_ALERT_ACTIONS.has(stableId) ? (stableId as DefectAlertAction) : null;
  }
  for (const candidate of resolveTextCandidates(input)) {
    if (candidate in DEFECT_ALERT_TEXT_TO_ACTION) {
      return DEFECT_ALERT_TEXT_TO_ACTION[candidate];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Defect 3, second question: days of delay — a fixed 3-option select
// (2/3/5, matching the prototype's DEFECT_SCREENS "days" field exactly),
// small enough for a quick-reply (max 3 WhatsApp buttons), unlike the
// 4-option return-reason field (#33 Part C), which needed a list-picker.
// ---------------------------------------------------------------------------

export type DefectDelayDays = 2 | 3 | 5;

const DELAY_DAYS_ACTIONS: ReadonlySet<string> = new Set(["filing:delay-2", "filing:delay-3", "filing:delay-5"]);

const DELAY_DAYS_ACTION_TO_VALUE: Record<string, DefectDelayDays> = {
  "filing:delay-2": 2,
  "filing:delay-3": 3,
  "filing:delay-5": 5,
};

const DELAY_DAYS_TEXT_TO_ACTION: Record<string, string> = {
  "1": "filing:delay-2",
  "2 days": "filing:delay-2",
  "2 ദിവസം": "filing:delay-2",
  "2": "filing:delay-3",
  "3 days": "filing:delay-3",
  "3 ദിവസം": "filing:delay-3",
  "3": "filing:delay-5",
  "5 days": "filing:delay-5",
  "5 ദിവസം": "filing:delay-5",
};

export function parseDelayDaysSelection(input: DefectSelectionInput): DefectDelayDays | null {
  const stableId = resolveStableId(input);
  if (stableId) {
    return DELAY_DAYS_ACTIONS.has(stableId) ? DELAY_DAYS_ACTION_TO_VALUE[stableId] : null;
  }
  for (const candidate of resolveTextCandidates(input)) {
    if (candidate in DELAY_DAYS_TEXT_TO_ACTION) {
      return DELAY_DAYS_ACTION_TO_VALUE[DELAY_DAYS_TEXT_TO_ACTION[candidate]];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Defect 3, first question: reason for delay — required free text, mirrors
// filing-details.ts's `story` field (no bank/format constraints apply here).
// ---------------------------------------------------------------------------

export type DelayReasonValidationReason = "REQUIRED" | "TOO_LONG";

export interface DelayReasonValidationResult {
  valid: boolean;
  reason?: DelayReasonValidationReason;
  normalized?: string;
}

const DELAY_REASON_MAX_LENGTH = 600;

export function validateDelayReason(value: string): DelayReasonValidationResult {
  const normalized = value.trim();
  if (!normalized) {
    return { valid: false, reason: "REQUIRED" };
  }
  if (normalized.length > DELAY_REASON_MAX_LENGTH) {
    return { valid: false, reason: "TOO_LONG" };
  }
  return { valid: true, normalized };
}

// ---------------------------------------------------------------------------
// FILING_DEFECT_REVIEW: the one available action — declaring and confirming
// are folded into this single tap (Part A has no separate declare state,
// matching the prototype's own single review-screen CTA button).
// ---------------------------------------------------------------------------

export type DefectReviewAction = "filing:defect-confirm";

const DEFECT_REVIEW_ACTIONS: ReadonlySet<string> = new Set(["filing:defect-confirm"]);

const DEFECT_REVIEW_TEXT_TO_ACTION: Record<string, DefectReviewAction> = {
  "1": "filing:defect-confirm",
  "pay ₹200 and send back": "filing:defect-confirm",
  "pay 200 and send back": "filing:defect-confirm",
  "₹200 അടച്ച് തിരികെ അയക്കുക": "filing:defect-confirm",
};

export function parseDefectReviewAction(input: DefectSelectionInput): DefectReviewAction | null {
  const stableId = resolveStableId(input);
  if (stableId) {
    return DEFECT_REVIEW_ACTIONS.has(stableId) ? (stableId as DefectReviewAction) : null;
  }
  for (const candidate of resolveTextCandidates(input)) {
    if (candidate in DEFECT_REVIEW_TEXT_TO_ACTION) {
      return DEFECT_REVIEW_TEXT_TO_ACTION[candidate];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// FILING_DEFECT_SENT: the one available action, back to the main menu.
// ---------------------------------------------------------------------------

export type DefectSentAction = "nav:main-menu";

const DEFECT_SENT_ACTIONS: ReadonlySet<string> = new Set(["nav:main-menu"]);

const DEFECT_SENT_TEXT_TO_ACTION: Record<string, DefectSentAction> = {
  "1": "nav:main-menu",
  "main menu": "nav:main-menu",
  "പ്രധാന മെനു": "nav:main-menu",
};

export function parseDefectSentAction(input: DefectSelectionInput): DefectSentAction | null {
  const stableId = resolveStableId(input);
  if (stableId) {
    return DEFECT_SENT_ACTIONS.has(stableId) ? (stableId as DefectSentAction) : null;
  }
  for (const candidate of resolveTextCandidates(input)) {
    if (candidate in DEFECT_SENT_TEXT_TO_ACTION) {
      return DEFECT_SENT_TEXT_TO_ACTION[candidate];
    }
  }
  return null;
}
