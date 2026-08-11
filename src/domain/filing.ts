export type DraftChoiceAction = "filing:resume-draft" | "filing:start-new" | "nav:main-menu";
export type FilingNoticeAction = "filing:accept-test-notice" | "nav:main-menu";

const DRAFT_CHOICE_ACTIONS: ReadonlySet<string> = new Set(["filing:resume-draft", "filing:start-new", "nav:main-menu"]);
const NOTICE_ACTIONS: ReadonlySet<string> = new Set(["filing:accept-test-notice", "nav:main-menu"]);

// Numbers and exact localized titles. Matching is case-insensitive for
// Latin text; Malayalam script has no case, so lower-casing it is a no-op.
const DRAFT_CHOICE_TEXT_TO_ACTION: Record<string, DraftChoiceAction> = {
  "1": "filing:resume-draft",
  "resume draft": "filing:resume-draft",
  "ഡ്രാഫ്റ്റ് തുടരുക": "filing:resume-draft",
  "2": "filing:start-new",
  "start new filing": "filing:start-new",
  "പുതിയ ഫയലിംഗ് ആരംഭിക്കുക": "filing:start-new",
  "3": "nav:main-menu",
  "main menu": "nav:main-menu",
  "പ്രധാന മെനു": "nav:main-menu",
};

const NOTICE_TEXT_TO_ACTION: Record<string, FilingNoticeAction> = {
  "1": "filing:accept-test-notice",
  continue: "filing:accept-test-notice",
  "തുടരുക": "filing:accept-test-notice",
  "2": "nav:main-menu",
  "main menu": "nav:main-menu",
  "പ്രധാന മെനു": "nav:main-menu",
};

export interface FilingSelectionInput {
  /** Twilio's stable ID for a quick-reply tap. */
  buttonPayload?: string;
  buttonText?: string;
  /** Twilio's stable ID for a list-picker selection (not used by V5A's own templates, kept for consistency with #5's inputs). */
  listId?: string;
  listTitle?: string;
  body?: string;
}

function resolveStableId(input: FilingSelectionInput): string {
  return (input.buttonPayload || input.listId || "").trim();
}

function resolveTextCandidates(input: FilingSelectionInput): string[] {
  return [(input.body || "").trim().toLowerCase(), (input.buttonText || input.listTitle || "").trim().toLowerCase()];
}

/**
 * Resolves a recognized draft-choice action. A supplied stable ID is
 * authoritative — same rule as #5's menu parsing: if present, it's either
 * the action or `null`, never a fallback into text matching. Text
 * fallbacks (numbered/localized title) only apply when no button/list
 * interaction was supplied at all.
 */
export function parseDraftChoiceAction(input: FilingSelectionInput): DraftChoiceAction | null {
  const stableId = resolveStableId(input);
  if (stableId) {
    return DRAFT_CHOICE_ACTIONS.has(stableId) ? (stableId as DraftChoiceAction) : null;
  }

  for (const candidate of resolveTextCandidates(input)) {
    if (candidate in DRAFT_CHOICE_TEXT_TO_ACTION) {
      return DRAFT_CHOICE_TEXT_TO_ACTION[candidate];
    }
  }
  return null;
}

/** Resolves a recognized test-notice action, with the same stable-ID-authoritative rule as `parseDraftChoiceAction`. */
export function parseFilingNoticeAction(input: FilingSelectionInput): FilingNoticeAction | null {
  const stableId = resolveStableId(input);
  if (stableId) {
    return NOTICE_ACTIONS.has(stableId) ? (stableId as FilingNoticeAction) : null;
  }

  for (const candidate of resolveTextCandidates(input)) {
    if (candidate in NOTICE_TEXT_TO_ACTION) {
      return NOTICE_TEXT_TO_ACTION[candidate];
    }
  }
  return null;
}
