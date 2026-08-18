/**
 * Validation and action parsing for #35 (Prototype parity — Phase 7): the
 * filed acknowledgement, simulated court-fee payment, and completion. Pure
 * functions, no I/O, no logging of the values they handle, matching every
 * other domain module in this codebase.
 */

// ---------------------------------------------------------------------------
// FILING_FILED: the one available action, paying the (simulated) court fee.
// ---------------------------------------------------------------------------

export type FilingFiledAction = "filing:pay-fee" | "nav:main-menu";

const FILING_FILED_ACTIONS: ReadonlySet<string> = new Set(["filing:pay-fee", "nav:main-menu"]);

// Numbers and the exact localized title, matching the plain-text fallback
// ("1. Pay court fee\n2. Main menu").
const FILING_FILED_TEXT_TO_ACTION: Record<string, FilingFiledAction> = {
  "1": "filing:pay-fee",
  "pay court fee": "filing:pay-fee",
  "pay the court fee": "filing:pay-fee",
  "pay fee": "filing:pay-fee",
  "2": "nav:main-menu",
  "main menu": "nav:main-menu",
};

/** Same shape as the other domain modules' selection input — kept local so this module has no dependency on their files. */
export interface FilingCompletionSelectionInput {
  buttonPayload?: string;
  buttonText?: string;
  body?: string;
}

function resolveStableId(input: FilingCompletionSelectionInput): string {
  return (input.buttonPayload || "").trim();
}

function resolveTextCandidates(input: FilingCompletionSelectionInput): string[] {
  return [(input.body || "").trim().toLowerCase(), (input.buttonText || "").trim().toLowerCase()];
}

/**
 * Resolves the "Pay court fee" action, with the same stable-ID-authoritative
 * rule as every other action parser in this codebase: if a stable ID is
 * present, it's either the action or `null`, never a fallback into text
 * matching.
 */
export function parseFilingFiledAction(input: FilingCompletionSelectionInput): FilingFiledAction | null {
  const stableId = resolveStableId(input);
  if (stableId) {
    return FILING_FILED_ACTIONS.has(stableId) ? (stableId as FilingFiledAction) : null;
  }

  for (const candidate of resolveTextCandidates(input)) {
    if (candidate in FILING_FILED_TEXT_TO_ACTION) {
      return FILING_FILED_TEXT_TO_ACTION[candidate];
    }
  }
  return null;
}
