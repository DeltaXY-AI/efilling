/**
 * Validation and action parsing for #34 (Prototype parity — Phase 6):
 * the draft-ready summary and simulated e-Sign (OTP) step. Pure functions,
 * no I/O, no logging of the values they handle, matching every other
 * domain module in this codebase.
 */

// ---------------------------------------------------------------------------
// FILING_DRAFT_READY: Review & e-Sign / Edit details.
// ---------------------------------------------------------------------------

export type DraftReadyAction = "filing:esign" | "filing:edit-details";

const DRAFT_READY_ACTIONS: ReadonlySet<string> = new Set(["filing:esign", "filing:edit-details"]);

// Numbers and exact localized titles, matching the plain-text fallback
// ("1. Review & e-Sign 2. Edit details").
const DRAFT_READY_TEXT_TO_ACTION: Record<string, DraftReadyAction> = {
  "1": "filing:esign",
  "review & e-sign": "filing:esign",
  "review and e-sign": "filing:esign",
  "2": "filing:edit-details",
  "edit details": "filing:edit-details",
};

/** Same shape as the other domain modules' selection input — kept local so this module has no dependency on their files. */
export interface FilingSignSelectionInput {
  buttonPayload?: string;
  buttonText?: string;
  body?: string;
}

function resolveStableId(input: FilingSignSelectionInput): string {
  return (input.buttonPayload || "").trim();
}

function resolveTextCandidates(input: FilingSignSelectionInput): string[] {
  return [(input.body || "").trim().toLowerCase(), (input.buttonText || "").trim().toLowerCase()];
}

/**
 * Resolves the draft-ready action (Review & e-Sign / Edit details), with
 * the same stable-ID-authoritative rule as every other action parser in
 * this codebase: if a stable ID is present, it's either the action or
 * `null`, never a fallback into text matching.
 */
export function parseDraftReadyAction(input: FilingSignSelectionInput): DraftReadyAction | null {
  const stableId = resolveStableId(input);
  if (stableId) {
    return DRAFT_READY_ACTIONS.has(stableId) ? (stableId as DraftReadyAction) : null;
  }

  for (const candidate of resolveTextCandidates(input)) {
    if (candidate in DRAFT_READY_TEXT_TO_ACTION) {
      return DRAFT_READY_TEXT_TO_ACTION[candidate];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// FILING_OTP_PENDING: a format-only check — never validated against any
// real OTP/Aadhaar/UIDAI service (Part B / Scope decisions).
// ---------------------------------------------------------------------------

const OTP_RE = /^\d{6}$/;

/** True only for exactly 6 digits, after trimming. No other validation is ever performed. */
export function isValidOtpFormat(value: string): boolean {
  return OTP_RE.test(value.trim());
}
