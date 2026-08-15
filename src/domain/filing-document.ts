/**
 * Validation and action parsing for the filing-document uploads collected
 * in #31 (Prototype parity — Phase 3): 5 sequential groups (cheque, bank
 * return memo, notice + proof of service, complainant ID proof, optional
 * supporting documents), each accepting 1+ WhatsApp media messages before
 * the advocate explicitly continues. Mirrors the shape of
 * ../domain/complainant.ts and ../domain/enrolment.ts: pure functions, no
 * I/O, no logging of file contents.
 */

// #33 Part E adds "narrative" — the optional written-account upload,
// handled by its own dedicated state (FILING_WRITTEN_ACCOUNT_PENDING) in
// filing-document-workflow.ts, never part of DOCUMENT_GROUP_ORDER below
// (that order is #31 Phase 3's own fixed 5-group cascade).
export type FilingDocumentGroup = "cheque" | "memo" | "notice" | "id" | "support" | "narrative";

export interface FilingDocumentGroupLimit {
  min: number;
  max: number;
}

/** Per-group min/max file counts (issue #31 Part A/E — notice allows up to 5, support is optional; #33 Part E's narrative group is likewise optional, 0-2). */
export const DOCUMENT_GROUP_LIMITS: Record<FilingDocumentGroup, FilingDocumentGroupLimit> = {
  cheque: { min: 1, max: 2 },
  memo: { min: 1, max: 2 },
  notice: { min: 1, max: 5 },
  id: { min: 1, max: 2 },
  support: { min: 0, max: 2 },
  narrative: { min: 0, max: 2 },
};

/** Every group in upload order — the sequence #31's state machine advances through. #33 Part E's "narrative" group is deliberately excluded: it's reached from a different part of the flow (after Part D), not this cascade. */
export const DOCUMENT_GROUP_ORDER: readonly FilingDocumentGroup[] = ["cheque", "memo", "notice", "id", "support"];

/** Confirmed with the product owner: images and PDFs only, capped at 10 MB per file (issue #31 Scope decisions). */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "application/pdf"]);

export function isAllowedContentType(contentType: string): boolean {
  return ALLOWED_CONTENT_TYPES.has(contentType.trim().toLowerCase());
}

/** True once a group has met its minimum — the only thing `docs:continue` is gated on (issue #31 Part A). */
export function hasMetMinimum(group: FilingDocumentGroup, currentCount: number): boolean {
  return currentCount >= DOCUMENT_GROUP_LIMITS[group].min;
}

/** True when one more file would exceed the group's max (issue #31 Part A: "file exceeding the group's max count"). */
export function wouldExceedMaximum(group: FilingDocumentGroup, currentCount: number): boolean {
  return currentCount >= DOCUMENT_GROUP_LIMITS[group].max;
}

// ---------------------------------------------------------------------------
// "docs:continue" action parsing — the one action every group recognizes.
// ---------------------------------------------------------------------------

export type FilingDocumentAction = "docs:continue";

const CONTINUE_STABLE_ID = "docs:continue";

// Text fallbacks: "done"/"continue" for required groups, plus "skip" (reusing
// this codebase's established Skip synonym from complainant-workflow.ts's
// optional email field) since the optional `support` group's minimum of 0 is
// already satisfied by zero files — "skip" and "continue" are the same
// action there, just worded for what the advocate is actually doing.
const CONTINUE_TEXT_TO_ACTION: Record<string, FilingDocumentAction> = {
  done: "docs:continue",
  continue: "docs:continue",
  skip: "docs:continue",
  "കഴിഞ്ഞു": "docs:continue",
  "തുടരുക": "docs:continue",
  "ഒഴിവാക്കുക": "docs:continue",
};

export interface FilingDocumentSelectionInput {
  buttonPayload?: string;
  buttonText?: string;
  body?: string;
}

/**
 * Resolves the "docs:continue" action from a stable ButtonPayload or a typed
 * "done"/"continue"/"skip" (English or Malayalam). A supplied stable ID is
 * authoritative — same rule as every other action parser in this codebase:
 * if present, it's either the action or `null`, never a fallback into text
 * matching. Returns `null` for anything else, including the media messages
 * themselves (those are handled separately, never through this parser).
 */
export function parseFilingDocumentAction(input: FilingDocumentSelectionInput): FilingDocumentAction | null {
  const stableId = (input.buttonPayload || "").trim();
  if (stableId) {
    return stableId === CONTINUE_STABLE_ID ? CONTINUE_STABLE_ID : null;
  }

  const bodyText = (input.body || "").trim().toLowerCase();
  if (bodyText in CONTINUE_TEXT_TO_ACTION) {
    return CONTINUE_TEXT_TO_ACTION[bodyText];
  }

  const titleText = (input.buttonText || "").trim().toLowerCase();
  if (titleText in CONTINUE_TEXT_TO_ACTION) {
    return CONTINUE_TEXT_TO_ACTION[titleText];
  }

  return null;
}
