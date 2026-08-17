/**
 * Validation and action parsing for #36 (Prototype parity — Phase 8): "My
 * cases" — the sectioned draft/case list and the per-draft detail card.
 * Pure functions, no I/O, no logging of the values they handle, matching
 * every other domain module in this codebase.
 */

function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatIsoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/**
 * S.138 NI Act limitation deadline (Scope decision, confirmed): the cause
 * of action arises 15 days after `serviceDate` (the notice-reply window),
 * and the complaint must be filed within 1 calendar month after that.
 * Returns a plain "YYYY-MM-DD" string — only ever called when serviceDate
 * is already on file (Phase 5 Part C); never guessed for an earlier-stage
 * draft that hasn't reached that field yet.
 */
export function computeLimitationDeadline(serviceDateIso: string): string {
  const serviceDate = parseIsoDate(serviceDateIso);
  const causeOfAction = new Date(serviceDate);
  causeOfAction.setUTCDate(causeOfAction.getUTCDate() + 15);
  const deadline = new Date(causeOfAction);
  deadline.setUTCMonth(deadline.getUTCMonth() + 1);
  return formatIsoDate(deadline);
}

/** Whole calendar days from `from` to `to` (both UTC-midnight-normalized dates) — negative once the deadline has passed. */
export function daysUntil(deadlineIso: string, from: Date): number {
  const deadline = parseIsoDate(deadlineIso);
  const fromMidnight = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  return Math.round((deadline.getTime() - fromMidnight.getTime()) / (24 * 60 * 60 * 1000));
}

const NAV_MAIN_MENU = "nav:main-menu";
const NAV_MAIN_MENU_TEXT: ReadonlySet<string> = new Set(["main menu", "പ്രധാന മെനു"]);
const PICK_ROW_PREFIX = "filing:pick-row-";

/** Same shape as the other domain modules' selection input — kept local so this module has no dependency on their files. */
export interface DraftListSelectionInput {
  buttonPayload?: string;
  buttonText?: string;
  listId?: string;
  listTitle?: string;
  body?: string;
}

export type DraftListSelection =
  // Twilio's list-picker Content Template must keep a FIXED item structure
  // to stay approvable — real, per-advocate row content is filled in per
  // send via content variables (see filing-draft-list-sender.ts), but each
  // item's `id` is always one of the 9 fixed positional slots
  // (filing:pick-row-1 .. filing:pick-row-9), never a filing's own id. A
  // typed number (no button/list tap at all) means the exact same thing.
  // Either way, only the workflow layer — which has the freshly-rendered
  // row order — can resolve a position to an actual filingId.
  | { kind: "position"; position: number }
  | { kind: "nav-main-menu" };

/**
 * Resolves a FILING_DRAFT_LIST row tap/reply. A supplied stable ID
 * (buttonPayload or listId) is authoritative — same rule as every other
 * action parser in this codebase: if present, it's either recognized or
 * `null`, never a fallback into text matching.
 */
export function parseDraftListSelection(input: DraftListSelectionInput): DraftListSelection | null {
  const stableId = (input.buttonPayload || input.listId || "").trim();
  if (stableId) {
    if (stableId === NAV_MAIN_MENU) {
      return { kind: "nav-main-menu" };
    }
    if (stableId.startsWith(PICK_ROW_PREFIX)) {
      const position = Number(stableId.slice(PICK_ROW_PREFIX.length));
      return Number.isInteger(position) && position > 0 ? { kind: "position", position } : null;
    }
    return null;
  }

  for (const candidate of [(input.body || "").trim().toLowerCase(), (input.listTitle || input.buttonText || "").trim().toLowerCase()]) {
    if (NAV_MAIN_MENU_TEXT.has(candidate)) {
      return { kind: "nav-main-menu" };
    }
    if (/^\d+$/.test(candidate)) {
      return { kind: "position", position: Number(candidate) };
    }
  }
  return null;
}

/**
 * FILING_DRAFT_DETAIL always shows exactly one, already-known draft (see
 * filing-draft-list-workflow.ts — resolved via conversations.active_filing_id,
 * never a second column). Its Continue filing/Discard draft/Main menu
 * quick-reply is genuinely static content, like every other quick-reply
 * template in this codebase (e.g. filing-declare's own actions) — no
 * per-request id variation, so unlike the list above, these ids never need
 * to embed anything.
 */
export type DraftDetailAction = "filing:resume-draft" | "filing:discard-draft" | "nav:main-menu";

const DRAFT_DETAIL_ACTIONS: ReadonlySet<string> = new Set(["filing:resume-draft", "filing:discard-draft", "nav:main-menu"]);

const DETAIL_TEXT_TO_ACTION: Record<string, DraftDetailAction> = {
  "1": "filing:resume-draft",
  "continue filing": "filing:resume-draft",
  "ഫയലിംഗ് തുടരുക": "filing:resume-draft",
  "2": "filing:discard-draft",
  "discard draft": "filing:discard-draft",
  "ഡ്രാഫ്റ്റ് ഒഴിവാക്കുക": "filing:discard-draft",
  "3": "nav:main-menu",
  "main menu": "nav:main-menu",
  "പ്രധാന മെനു": "nav:main-menu",
};

/** Resolves a FILING_DRAFT_DETAIL action, with the same stable-ID-authoritative rule as parseDraftListSelection. */
export function parseDraftDetailAction(input: DraftListSelectionInput): DraftDetailAction | null {
  const stableId = (input.buttonPayload || "").trim();
  if (stableId) {
    return DRAFT_DETAIL_ACTIONS.has(stableId) ? (stableId as DraftDetailAction) : null;
  }

  for (const candidate of [(input.body || "").trim().toLowerCase(), (input.buttonText || "").trim().toLowerCase()]) {
    if (candidate in DETAIL_TEXT_TO_ACTION) {
      return DETAIL_TEXT_TO_ACTION[candidate];
    }
  }
  return null;
}

/**
 * #37 — FILING_DRAFT_DETAIL's other shape: a FILED case's read-only status
 * screen (#36), now with one demo action added, "Simulate scrutiny
 * defects" — never confused with DraftDetailAction above, which only ever
 * applies to a DRAFT filing. filing-draft-list-workflow.ts's
 * handleFilingDraftDetailInput branches on the underlying filing's status
 * to pick which of these two action sets applies.
 */
export type CaseDetailAction = "filing:simulate-defects" | "nav:main-menu";

const CASE_DETAIL_ACTIONS: ReadonlySet<string> = new Set(["filing:simulate-defects", "nav:main-menu"]);

const CASE_DETAIL_TEXT_TO_ACTION: Record<string, CaseDetailAction> = {
  "1": "filing:simulate-defects",
  "simulate scrutiny defects": "filing:simulate-defects",
  "സ്ക്രൂട്ടിനി ന്യൂനതകൾ അനുകരിക്കുക": "filing:simulate-defects",
  "2": "nav:main-menu",
  "main menu": "nav:main-menu",
  "പ്രധാന മെനു": "nav:main-menu",
};

/** Resolves a FILED case's status-screen action, with the same stable-ID-authoritative rule as parseDraftListSelection. */
export function parseCaseDetailAction(input: DraftListSelectionInput): CaseDetailAction | null {
  const stableId = (input.buttonPayload || "").trim();
  if (stableId) {
    return CASE_DETAIL_ACTIONS.has(stableId) ? (stableId as CaseDetailAction) : null;
  }

  for (const candidate of [(input.body || "").trim().toLowerCase(), (input.buttonText || "").trim().toLowerCase()]) {
    if (candidate in CASE_DETAIL_TEXT_TO_ACTION) {
      return CASE_DETAIL_TEXT_TO_ACTION[candidate];
    }
  }
  return null;
}
