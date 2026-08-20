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

export interface SampleDocumentSpec {
  storageUrl: string;
  contentType: string;
}

/**
 * Fixed canned "documents" for the "sample"/"demo files" typed shortcut
 * (see parseFilingDocumentAction below) — never real files, never uploaded
 * to or downloaded from anywhere. The storage URLs are deliberately
 * non-resolving (`demo.internal.efiling` isn't a real host) so nothing that
 * later touches `filing_documents.storageUrl` (e.g. the draft-discard
 * cleanup in filing-draft-list-workflow.ts, already wrapped in try/catch)
 * mistakes one of these for a real Blob object.
 */
export const SAMPLE_DOCUMENTS: Record<FilingDocumentGroup, SampleDocumentSpec[]> = {
  cheque: [
    { storageUrl: "https://demo.internal.efiling/samples/cheque/front.jpg", contentType: "image/jpeg" },
    { storageUrl: "https://demo.internal.efiling/samples/cheque/back.jpg", contentType: "image/jpeg" },
  ],
  memo: [{ storageUrl: "https://demo.internal.efiling/samples/memo/return-memo.jpg", contentType: "image/jpeg" }],
  notice: [
    { storageUrl: "https://demo.internal.efiling/samples/notice/demand-notice.jpg", contentType: "image/jpeg" },
    { storageUrl: "https://demo.internal.efiling/samples/notice/postal-receipt.jpg", contentType: "image/jpeg" },
  ],
  id: [{ storageUrl: "https://demo.internal.efiling/samples/id/pan-card.jpg", contentType: "image/jpeg" }],
  support: [{ storageUrl: "https://demo.internal.efiling/samples/support/invoice.jpg", contentType: "image/jpeg" }],
  narrative: [{ storageUrl: "https://demo.internal.efiling/samples/narrative/written-account.pdf", contentType: "application/pdf" }],
};

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

export type FilingDocumentAction = "docs:continue" | "docs:use-sample-files";

const CONTINUE_STABLE_ID = "docs:continue";

// A stable button ID for the sample-files shortcut, added alongside
// CONTINUE_STABLE_ID once a real WhatsApp button existed for it (the
// "filing-doc-continue"/"filing-doc-continue-only" quick-reply templates) —
// see filing-document-workflow.ts/filing-defect-workflow.ts's optional
// contentSid-driven prompts. Typed "sample"/"demo files" (below) still work
// unchanged; this is purely additive.
const SAMPLE_STABLE_ID = "docs:use-sample-files";

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

// A testing/demo shortcut that fills the current group with a fixed set of
// canned demo files instead of a real upload, for testing/demoing this flow
// without needing real photos. Also reachable via SAMPLE_STABLE_ID (the
// "Add sample files" quick-reply button, above), checked alongside
// CONTINUE_TEXT_TO_ACTION here for the typed fallback.
const SAMPLE_FILES_TEXT_TO_ACTION: Record<string, FilingDocumentAction> = {
  sample: "docs:use-sample-files",
  "sample files": "docs:use-sample-files",
  "add sample files": "docs:use-sample-files",
  demo: "docs:use-sample-files",
  "demo files": "docs:use-sample-files",
  "സാമ്പിൾ": "docs:use-sample-files",
  "സാമ്പിൾ ഫയലുകൾ": "docs:use-sample-files",
};

export interface FilingDocumentSelectionInput {
  buttonPayload?: string;
  buttonText?: string;
  body?: string;
}

/**
 * Resolves "docs:continue" (a stable ButtonPayload, or typed
 * "done"/"continue"/"skip", English or Malayalam) or "docs:use-sample-files"
 * (a stable ButtonPayload, or typed "sample"/"demo files" etc., English or
 * Malayalam). A supplied stable ID is authoritative — same rule as every
 * other action parser in this codebase: if present, it's one of the two
 * known actions or `null`, never a fallback into text matching. Returns
 * `null` for anything else, including the media messages themselves (those
 * are handled separately, never through this parser).
 */
export function parseFilingDocumentAction(input: FilingDocumentSelectionInput): FilingDocumentAction | null {
  const stableId = (input.buttonPayload || "").trim();
  if (stableId) {
    if (stableId === CONTINUE_STABLE_ID) return CONTINUE_STABLE_ID;
    if (stableId === SAMPLE_STABLE_ID) return SAMPLE_STABLE_ID;
    return null;
  }

  const bodyText = (input.body || "").trim().toLowerCase();
  if (bodyText in CONTINUE_TEXT_TO_ACTION) {
    return CONTINUE_TEXT_TO_ACTION[bodyText];
  }
  if (bodyText in SAMPLE_FILES_TEXT_TO_ACTION) {
    return SAMPLE_FILES_TEXT_TO_ACTION[bodyText];
  }

  const titleText = (input.buttonText || "").trim().toLowerCase();
  if (titleText in CONTINUE_TEXT_TO_ACTION) {
    return CONTINUE_TEXT_TO_ACTION[titleText];
  }
  if (titleText in SAMPLE_FILES_TEXT_TO_ACTION) {
    return SAMPLE_FILES_TEXT_TO_ACTION[titleText];
  }

  return null;
}
