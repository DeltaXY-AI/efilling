import type { TwilioMessagingClient } from "../adapters/twilio/messaging-client";
import { computeLimitationDeadline, daysUntil } from "../domain/filing-draft-list";
import { DOCUMENT_GROUP_ORDER, hasMetMinimum, type FilingDocumentGroup } from "../domain/filing-document";
import { formatIsoDateAsDisplay, formatIstTimestamp } from "../lib/format-ist-date";
import { logWorkflowError } from "../lib/logger";
import type { FilingRecord } from "../repositories/filing-repository";
import type { SupportedLanguage } from "./main-menu-sender";

/**
 * Sends and copy for #36 (Prototype parity — Phase 8): "My cases" — the
 * sectioned Drafts/Active-cases list, the per-draft detail card, the
 * read-only case-status view, and the discard confirmation. Every row is
 * built from the filing's own persisted fields — never hardcoded per
 * advocate.
 *
 * Twilio's `twilio/list-picker` Content Template has no native "section
 * header" (unlike raw WhatsApp's own Interactive List API) — Scope
 * decision: sectioning is conveyed by ordering (Drafts, then Active cases)
 * and each row's own content, not an artificial section-name prefix. The
 * template's item *structure* (10 fixed positional ids, `filing:pick-row-1`
 * .. `filing:pick-row-9` + `nav:main-menu`) must stay fixed for Twilio/
 * WhatsApp approval; only the visible `item`/`description` text is filled
 * per send via `{{n}}` content variables. Any of the 9 row slots beyond the
 * advocate's actual filing count is filled with an inert placeholder — see
 * EMPTY_ROW_MARKER below — which the workflow treats as a stale/invalid
 * position (a no-op redisplay), the same as any other unrecognized input.
 */
export interface FilingDraftListSenderDeps {
  messagingClient: TwilioMessagingClient;
  fromNumber: string;
  draftListContentSid: Record<SupportedLanguage, string>;
  draftDetailActionsContentSid: Record<SupportedLanguage, string>;
  /** #37 — the read-only case-status screen's new "Simulate scrutiny defects" / "Main menu" actions. */
  caseStatusActionsContentSid: Record<SupportedLanguage, string>;
}

export interface SendFilingDraftListMessageInput {
  to: string;
  language: SupportedLanguage;
  /** Twilio MessageSid, used only for safe error correlation — never logged with content. */
  correlationId: string;
}

// WhatsApp List message hard limits (Part C) — not stylistic choices.
const MAX_TITLE_LENGTH = 24;
const MAX_DESCRIPTION_LENGTH = 72;
// Reserves exactly 1 of WhatsApp's 10-row hard cap for the fixed "Main
// menu" row (Part C: max 10 rows total).
const MAX_DATA_ROWS = 9;

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

// Indian digit grouping (last 3 digits, then groups of 2) — e.g. "450000" -> "4,50,000".
function formatIndianAmount(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) {
    return raw;
  }
  const lastThreeDigits = digits.slice(-3);
  const otherDigits = digits.slice(0, -3);
  const lastThree = otherDigits !== "" ? `,${lastThreeDigits}` : lastThreeDigits;
  const formattedOther = otherDigits.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return formattedOther + lastThree;
}

const COURT_FEE_TEXT: Record<SupportedLanguage, string> = { en: "Rs.", ml: "₹" };

export interface DraftListRow {
  filingId: string;
  rowKind: "draft" | "case";
  title: string;
  description: string;
}

/** True once every required document group (#31's DOCUMENT_GROUP_ORDER) has met its minimum — a real, derived signal, never "details read from the documents" (this app has no OCR — #32). */
export function documentsComplete(countsByGroup: Partial<Record<FilingDocumentGroup, number>>): boolean {
  return DOCUMENT_GROUP_ORDER.every((group) => hasMetMinimum(group, countsByGroup[group] ?? 0));
}

function draftDescription(language: SupportedLanguage, filing: FilingRecord, accusedName: string | null, docsComplete: boolean): string {
  const amount = filing.chequeAmount ? `${COURT_FEE_TEXT[language]}${formatIndianAmount(filing.chequeAmount)}` : null;
  const readyToSign = filing.currentStep === "FILING_DRAFT_READY" || filing.currentStep === "FILING_OTP_PENDING" || filing.declarationAcceptedAt !== null;

  if (accusedName && amount && readyToSign) {
    return language === "ml" ? `${accusedName} · ${amount} · ഇ-സൈൻ ചെയ്യാൻ തയ്യാർ` : `${accusedName} · ${amount} · ready to e-Sign`;
  }
  if (accusedName && amount) {
    return language === "ml"
      ? `${accusedName} · ${amount} · ${docsComplete ? "രേഖകൾ അപ്‌ലോഡ് ചെയ്തു" : "കേസ് വിവരങ്ങൾ പുരോഗമിക്കുന്നു"}`
      : `${accusedName} · ${amount} · ${docsComplete ? "documents uploaded" : "case details in progress"}`;
  }
  if (accusedName) {
    return language === "ml" ? `${accusedName} · കേസ് വിവരങ്ങൾ പുരോഗമിക്കുന്നു` : `${accusedName} · case details in progress`;
  }
  const started = formatIsoDateAsDisplay(filing.createdAt.toISOString().slice(0, 10));
  return language === "ml" ? `ആരംഭിച്ചത് ${started}` : `Started ${started}`;
}

function buildDraftRow(language: SupportedLanguage, filing: FilingRecord, accusedName: string | null, docsComplete: boolean): DraftListRow {
  const title = language === "ml" ? "ഡ്രാഫ്റ്റ് · S.138 പരാതി" : "Draft · S.138 complaint";
  return {
    filingId: filing.id,
    rowKind: "draft",
    title: truncate(title, MAX_TITLE_LENGTH),
    description: truncate(draftDescription(language, filing, accusedName, docsComplete), MAX_DESCRIPTION_LENGTH),
  };
}

function buildCaseRow(language: SupportedLanguage, filing: FilingRecord, accusedName: string | null): DraftListRow {
  const filedAt = filing.filedAt ? formatIsoDateAsDisplay(filing.filedAt.toISOString().slice(0, 10)) : "";
  const description =
    language === "ml"
      ? `${accusedName ?? "?"}-നെതിരെ · ഫയൽ ചെയ്തത് ${filedAt}`
      : `vs ${accusedName ?? "unnamed accused"} · filed ${filedAt}`;
  return {
    filingId: filing.id,
    rowKind: "case",
    title: truncate(filing.diaryNumber ?? "", MAX_TITLE_LENGTH),
    description: truncate(description, MAX_DESCRIPTION_LENGTH),
  };
}

export interface BuildDraftListRowsResult {
  rows: DraftListRow[];
  overflowCount: number;
}

/**
 * Orders Drafts (status DRAFT) before Active cases (status FILED), newest
 * first within each — `filings` is expected already sorted newest-first
 * (FilingRepository.listByConversation's own contract). Caps at
 * MAX_DATA_ROWS (Part C's "no silent caps" principle — the overflow count
 * is returned so the caller can say so, never just dropped).
 */
export function buildDraftListRows(
  language: SupportedLanguage,
  filings: FilingRecord[],
  accusedNameByFilingId: Map<string, string | null>,
  docsCompleteByFilingId: Map<string, boolean>,
): BuildDraftListRowsResult {
  const drafts = filings.filter((f) => f.status === "DRAFT");
  const active = filings.filter((f) => f.status === "FILED");
  const ordered = [...drafts, ...active];

  const rows = ordered.slice(0, MAX_DATA_ROWS).map((filing) => {
    const accusedName = accusedNameByFilingId.get(filing.id) ?? null;
    return filing.status === "DRAFT"
      ? buildDraftRow(language, filing, accusedName, docsCompleteByFilingId.get(filing.id) ?? false)
      : buildCaseRow(language, filing, accusedName);
  });

  return { rows, overflowCount: Math.max(0, ordered.length - MAX_DATA_ROWS) };
}

const MINE_PROMPT: Record<SupportedLanguage, string> = {
  en: "Here's everything of yours at the ON Court, most recent first.\n\nDrafts are kept for 30 days.",
  ml: "ON കോടതിയിലെ നിങ്ങളുടെ എല്ലാം ഇതാ, ഏറ്റവും പുതിയത് ആദ്യം.\n\nഡ്രാഫ്റ്റുകൾ 30 ദിവസത്തേക്ക് സൂക്ഷിക്കും.",
};

const OVERFLOW_NOTE: Record<SupportedLanguage, (count: number) => string> = {
  en: (count) => `\n\n+${count} more not shown — contact support to see them.`,
  ml: (count) => `\n\n+${count} എണ്ണം കൂടി കാണിച്ചിട്ടില്ല — അവ കാണാൻ സപ്പോർട്ടിനെ ബന്ധപ്പെടുക.`,
};

const NO_CASES_TEXT: Record<SupportedLanguage, string> = {
  en: "You don't have any drafts or filed cases yet.",
  ml: "നിങ്ങൾക്ക് ഇതുവരെ ഡ്രാഫ്റ്റുകളോ ഫയൽ ചെയ്ത കേസുകളോ ഇല്ല.",
};

export function renderMinePromptBody(language: SupportedLanguage, hasAnyRows: boolean, overflowCount: number): string {
  if (!hasAnyRows) {
    return NO_CASES_TEXT[language];
  }
  const overflow = overflowCount > 0 ? OVERFLOW_NOTE[language](overflowCount) : "";
  return `${MINE_PROMPT[language]}${overflow}`;
}

// Fills any of the 9 fixed row slots beyond the advocate's real row count —
// never a duplicated real entry (see module docstring). The template's own
// fixed 10th item ("Main menu"/"nav:main-menu") needs no variable at all.
const EMPTY_ROW_TITLE = "—";

function rowContentVariables(language: SupportedLanguage, rows: DraftListRow[], overflowCount: number): Record<string, string> {
  const variables: Record<string, string> = { "1": renderMinePromptBody(language, rows.length > 0, overflowCount) };
  for (let index = 0; index < MAX_DATA_ROWS; index += 1) {
    const row = rows[index];
    variables[String(2 + index * 2)] = row ? row.title : EMPTY_ROW_TITLE;
    variables[String(3 + index * 2)] = row ? row.description : "";
  }
  return variables;
}

function plainTextDraftList(language: SupportedLanguage, rows: DraftListRow[], overflowCount: number): string {
  const body = renderMinePromptBody(language, rows.length > 0, overflowCount);
  if (rows.length === 0) {
    return body;
  }
  const lines = rows.map((row, index) => `${index + 1}. ${row.title} — ${row.description}`);
  const instructions = language === "ml" ? "ഒരു നമ്പർ നൽകുക, അല്ലെങ്കിൽ 'menu' എന്ന് നൽകുക." : "Reply with a number, or reply 'menu' for the main menu.";
  return [body, "", ...lines, "", instructions].join("\n");
}

/** Sends the sectioned draft/case list — a Content Template (fixed 10-row structure, filled per send via content variables) with a plain-text fallback listing only the real rows. */
export async function sendDraftListMessage(
  deps: FilingDraftListSenderDeps,
  input: SendFilingDraftListMessageInput,
  rows: DraftListRow[],
  overflowCount: number,
): Promise<boolean> {
  try {
    await deps.messagingClient.sendContentTemplate({
      from: deps.fromNumber,
      to: input.to,
      contentSid: deps.draftListContentSid[input.language],
      contentVariables: rowContentVariables(input.language, rows, overflowCount),
    });
    return true;
  } catch {
    logWorkflowError({ code: "filing_draft_list_content_send_failed", correlationId: input.correlationId });
    try {
      await deps.messagingClient.sendText({ from: deps.fromNumber, to: input.to, body: plainTextDraftList(input.language, rows, overflowCount) });
      return true;
    } catch {
      logWorkflowError({ code: "filing_draft_list_fallback_send_failed", correlationId: input.correlationId });
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Per-draft detail card.
// ---------------------------------------------------------------------------

const DRAFT_CARD_LABELS: Record<SupportedLanguage, { title: string; accused: string; saved: string; docsDone: string; docsPending: string; detailsDone: string; detailsPending: string; fileBefore: string; daysLeft: (n: number) => string; overdue: (n: number) => string }> = {
  en: {
    title: "📝 Draft — cheque bounce complaint",
    accused: "Accused",
    saved: "Saved",
    docsDone: "✅ Documents uploaded",
    docsPending: "⬜ Documents not yet uploaded",
    detailsDone: "✅ Case details entered",
    detailsPending: "⬜ Case details not yet entered",
    fileBefore: "⏳ File before",
    daysLeft: (n) => `${n} days left.`,
    overdue: (n) => `deadline has passed — ${n} days overdue.`,
  },
  ml: {
    title: "📝 ഡ്രാഫ്റ്റ് — ചെക്ക് ബൗൺസ് പരാതി",
    accused: "പ്രതി",
    saved: "സേവ് ചെയ്തത്",
    docsDone: "✅ രേഖകൾ അപ്‌ലോഡ് ചെയ്തു",
    docsPending: "⬜ രേഖകൾ ഇതുവരെ അപ്‌ലോഡ് ചെയ്തിട്ടില്ല",
    detailsDone: "✅ കേസ് വിവരങ്ങൾ നൽകി",
    detailsPending: "⬜ കേസ് വിവരങ്ങൾ ഇതുവരെ നൽകിയിട്ടില്ല",
    fileBefore: "⏳ ഇതിന് മുൻപ് ഫയൽ ചെയ്യുക",
    daysLeft: (n) => `${n} ദിവസം ബാക്കിയുണ്ട്.`,
    overdue: (n) => `സമയപരിധി കഴിഞ്ഞു — ${n} ദിവസം വൈകി.`,
  },
};

export function renderDraftCard(language: SupportedLanguage, filing: FilingRecord, accusedName: string | null, docsComplete: boolean, now: Date): string {
  const labels = DRAFT_CARD_LABELS[language];
  const lines = [labels.title, ""];
  lines.push(`${labels.accused}: ${accusedName ?? "—"}`);
  if (filing.chequeNumber) {
    const amount = filing.chequeAmount ? ` · ${COURT_FEE_TEXT[language]}${formatIndianAmount(filing.chequeAmount)}` : "";
    lines.push(`Cheque ${filing.chequeNumber}${amount}`);
  }
  lines.push(`${labels.saved} ${formatIstTimestamp(filing.updatedAt)}`);
  lines.push("");
  lines.push(docsComplete ? labels.docsDone : labels.docsPending);
  lines.push(filing.declarationAcceptedAt ? labels.detailsDone : labels.detailsPending);

  if (filing.serviceDate) {
    const deadline = computeLimitationDeadline(filing.serviceDate);
    const daysLeft = daysUntil(deadline, now);
    const deadlineLine = daysLeft >= 0 ? labels.daysLeft(daysLeft) : labels.overdue(-daysLeft);
    lines.push("");
    lines.push(`${labels.fileBefore} ${formatIsoDateAsDisplay(deadline)} — ${deadlineLine}`);
  }

  return lines.join("\n");
}

const DRAFT_DETAIL_PLAIN_ACTIONS: Record<SupportedLanguage, string> = {
  en: ["1. Continue filing", "2. Discard draft", "3. Main menu", "", "Reply with 1, 2, or 3."].join("\n"),
  ml: ["1. ഫയലിംഗ് തുടരുക", "2. ഡ്രാഫ്റ്റ് ഒഴിവാക്കുക", "3. പ്രധാന മെനു", "", "1, 2, അല്ലെങ്കിൽ 3 എന്ന് മറുപടി നൽകുക."].join("\n"),
};

/** Sends the draft card's text, then its Continue filing/Discard draft/Main menu Content Template (falling back to numbered plain text). */
export async function sendDraftCardMessage(
  deps: FilingDraftListSenderDeps,
  input: SendFilingDraftListMessageInput,
  filing: FilingRecord,
  accusedName: string | null,
  docsComplete: boolean,
  now: Date,
): Promise<boolean> {
  let delivered: boolean;
  try {
    await deps.messagingClient.sendText({ from: deps.fromNumber, to: input.to, body: renderDraftCard(input.language, filing, accusedName, docsComplete, now) });
    delivered = true;
  } catch {
    logWorkflowError({ code: "filing_draft_card_send_failed", correlationId: input.correlationId });
    delivered = false;
  }

  try {
    await deps.messagingClient.sendContentTemplate({
      from: deps.fromNumber,
      to: input.to,
      contentSid: deps.draftDetailActionsContentSid[input.language],
    });
    return delivered;
  } catch {
    logWorkflowError({ code: "filing_draft_detail_actions_content_send_failed", correlationId: input.correlationId });
    try {
      await deps.messagingClient.sendText({ from: deps.fromNumber, to: input.to, body: DRAFT_DETAIL_PLAIN_ACTIONS[input.language] });
      return delivered;
    } catch {
      logWorkflowError({ code: "filing_draft_detail_actions_fallback_send_failed", correlationId: input.correlationId });
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Read-only case status (Active cases — no edit actions).
// ---------------------------------------------------------------------------

export function renderCaseStatus(language: SupportedLanguage, filing: FilingRecord, accusedName: string | null): string {
  const filedAt = filing.filedAt ? formatIstTimestamp(filing.filedAt) : "";
  return language === "ml"
    ? [`📄 ${filing.diaryNumber ?? ""}`, "", `${accusedName ?? "?"}-ന് എതിരെ`, `ഫയൽ ചെയ്തത്: ${filedAt}`, "കോടതി: " + (filing.selectedCourt ?? "")].join("\n")
    : [`📄 ${filing.diaryNumber ?? ""}`, "", `vs ${accusedName ?? "unnamed accused"}`, `Filed: ${filedAt}`, `Court: ${filing.selectedCourt ?? ""}`].join("\n");
}

export async function sendCaseStatus(
  deps: { messagingClient: TwilioMessagingClient; fromNumber: string },
  input: SendFilingDraftListMessageInput,
  filing: FilingRecord,
  accusedName: string | null,
): Promise<boolean> {
  try {
    await deps.messagingClient.sendText({ from: deps.fromNumber, to: input.to, body: renderCaseStatus(input.language, filing, accusedName) });
    return true;
  } catch {
    logWorkflowError({ code: "filing_case_status_send_failed", correlationId: input.correlationId });
    return false;
  }
}

// #37 — the case-status screen's own actions: "Simulate scrutiny defects"
// (a demo trigger, since there is no real Scrutiny Officer role) and "Main
// menu". Distinct from the draft card's Continue/Discard actions above —
// see domain/filing-draft-list.ts's CaseDetailAction.
const CASE_STATUS_ACTIONS_PLAIN_TEXT: Record<SupportedLanguage, string> = {
  en: ["1. Simulate scrutiny defects", "2. Main menu", "", "Reply with 1 or 2."].join("\n"),
  ml: ["1. സ്ക്രൂട്ടിനി ന്യൂനതകൾ അനുകരിക്കുക", "2. പ്രധാന മെനു", "", "1 അല്ലെങ്കിൽ 2 എന്ന് മറുപടി നൽകുക."].join("\n"),
};

export async function sendCaseStatusActions(deps: FilingDraftListSenderDeps, input: SendFilingDraftListMessageInput): Promise<boolean> {
  try {
    await deps.messagingClient.sendContentTemplate({ from: deps.fromNumber, to: input.to, contentSid: deps.caseStatusActionsContentSid[input.language] });
    return true;
  } catch {
    logWorkflowError({ code: "filing_case_status_actions_content_send_failed", correlationId: input.correlationId });
    try {
      await deps.messagingClient.sendText({ from: deps.fromNumber, to: input.to, body: CASE_STATUS_ACTIONS_PLAIN_TEXT[input.language] });
      return true;
    } catch {
      logWorkflowError({ code: "filing_case_status_actions_fallback_send_failed", correlationId: input.correlationId });
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Discard confirmation.
// ---------------------------------------------------------------------------

const DISCARDED_TEXT: Record<SupportedLanguage, string> = {
  en: "Draft discarded. The documents you had uploaded have been deleted from the court's servers.",
  ml: "ഡ്രാഫ്റ്റ് ഒഴിവാക്കി. അപ്‌ലോഡ് ചെയ്ത രേഖകൾ കോടതിയുടെ സെർവറിൽ നിന്ന് നീക്കം ചെയ്തു.",
};

export async function sendDiscarded(
  deps: { messagingClient: TwilioMessagingClient; fromNumber: string },
  input: SendFilingDraftListMessageInput,
): Promise<boolean> {
  try {
    await deps.messagingClient.sendText({ from: deps.fromNumber, to: input.to, body: DISCARDED_TEXT[input.language] });
    return true;
  } catch {
    logWorkflowError({ code: "filing_draft_discarded_send_failed", correlationId: input.correlationId });
    return false;
  }
}
