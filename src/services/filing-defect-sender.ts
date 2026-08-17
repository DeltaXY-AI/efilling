import type { TwilioMessagingClient } from "../adapters/twilio/messaging-client";
import type { FilingRecord } from "../repositories/filing-repository";
import { formatIstTimestamp } from "../lib/format-ist-date";
import { logWorkflowError } from "../lib/logger";
import type { SupportedLanguage } from "./main-menu-sender";

/**
 * Sends and copy for #37 (Prototype parity — Phase 9): the simulated
 * scrutiny-defect alert, the 3 fixed defect prompts, the review summary +
 * actions, and the resubmission acknowledgement.
 *
 * Scope decision (confirmed): this is the Kollam/ON-Court demo's fixed
 * defect scenario, matching the prototype's own DEFECT_SCREENS content
 * exactly — the cheque-number mismatch (004152 vs 004512), the illegible
 * cheque_front.jpg, and the notified/due dates are deliberately hardcoded
 * demo text, not derived from this filing's own persisted fields (there is
 * no real Scrutiny Officer role to have entered them). The diary number and
 * every timestamp shown ARE the filing's own persisted values — never
 * hardcoded — the same "real value, fixed narrative" split Phase 7 already
 * draws between the ₹500 court-fee *label* and the *actual* diary number.
 */
export interface FilingDefectSenderDeps {
  messagingClient: TwilioMessagingClient;
  fromNumber: string;
  caseStatusActionsContentSid: Record<SupportedLanguage, string>;
  defectAlertActionsContentSid: Record<SupportedLanguage, string>;
  delayDaysContentSid: Record<SupportedLanguage, string>;
  defectReviewActionsContentSid: Record<SupportedLanguage, string>;
  defectSentActionsContentSid: Record<SupportedLanguage, string>;
}

export interface SendFilingDefectMessageInput {
  to: string;
  language: SupportedLanguage;
  /** Twilio MessageSid, used only for safe error correlation — never logged with content. */
  correlationId: string;
}

async function sendPlain(
  deps: { messagingClient: TwilioMessagingClient; fromNumber: string },
  input: SendFilingDefectMessageInput,
  body: string,
  errorCode: string,
): Promise<boolean> {
  try {
    await deps.messagingClient.sendText({ from: deps.fromNumber, to: input.to, body });
    return true;
  } catch {
    logWorkflowError({ code: errorCode, correlationId: input.correlationId });
    return false;
  }
}

async function sendActionsWithFallback(
  deps: { messagingClient: TwilioMessagingClient; fromNumber: string },
  input: SendFilingDefectMessageInput,
  contentSid: string,
  fallbackText: string,
  codePrefix: string,
): Promise<boolean> {
  try {
    await deps.messagingClient.sendContentTemplate({ from: deps.fromNumber, to: input.to, contentSid });
    return true;
  } catch {
    logWorkflowError({ code: `${codePrefix}_content_send_failed`, correlationId: input.correlationId });
    try {
      await deps.messagingClient.sendText({ from: deps.fromNumber, to: input.to, body: fallbackText });
      return true;
    } catch {
      logWorkflowError({ code: `${codePrefix}_fallback_send_failed`, correlationId: input.correlationId });
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Case-status screen (#36's read-only FILED case view) — the new
// "Simulate scrutiny defects" / "Main menu" actions.
// ---------------------------------------------------------------------------

const PLAIN_TEXT_CASE_STATUS_ACTIONS: Record<SupportedLanguage, string> = {
  en: ["1. Simulate scrutiny defects", "2. Main menu", "", "Reply with 1 or 2."].join("\n"),
  ml: ["1. സ്ക്രൂട്ടിനി ന്യൂനതകൾ അനുകരിക്കുക", "2. പ്രധാന മെനു", "", "1 അല്ലെങ്കിൽ 2 എന്ന് മറുപടി നൽകുക."].join("\n"),
};

export function sendCaseStatusActions(deps: FilingDefectSenderDeps, input: SendFilingDefectMessageInput): Promise<boolean> {
  return sendActionsWithFallback(deps, input, deps.caseStatusActionsContentSid[input.language], PLAIN_TEXT_CASE_STATUS_ACTIONS[input.language], "filing_case_status_actions");
}

// ---------------------------------------------------------------------------
// FILING_DEFECT_ALERT: defectAlert + defectList (PR.md Appendix A.10 /
// DEFECT_SCREENS) + the "Correct the defects" action.
// ---------------------------------------------------------------------------

/** Renders the defect alert from the filing's own persisted diaryNumber/selectedCourt/complainant+accused names/defectNotifiedAt — never hardcoded, unlike the prototype's single-scenario demo. */
export function renderDefectAlert(language: SupportedLanguage, filing: FilingRecord, complainantName: string | null, accusedName: string | null): string {
  const notifiedAt = filing.defectNotifiedAt ? formatIstTimestamp(filing.defectNotifiedAt) : "";
  return language === "ml"
    ? [
        "⚠️ *നിങ്ങളുടെ ഫയലിംഗിൽ 3 ന്യൂനതകൾ*",
        "",
        `ഡയറി നം. *${filing.diaryNumber ?? ""}*`,
        `*${complainantName ?? "?"} vs ${accusedName ?? "?"}*`,
        filing.selectedCourt ?? "",
        "",
        `*${notifiedAt}*-ന് സ്ക്രൂട്ടിനി ഓഫീസർ പരിശോധിച്ച് തിരികെ അയച്ചു. മൂന്നും തീർക്കുന്നതുവരെ കേസിന് നമ്പർ ലഭിക്കില്ല.`,
      ].join("\n")
    : [
        "⚠️ *3 defects marked on your filing*",
        "",
        `Diary no. *${filing.diaryNumber ?? ""}*`,
        `*${complainantName ?? "?"} vs ${accusedName ?? "?"}*`,
        filing.selectedCourt ?? "",
        "",
        `The scrutiny officer checked your complaint on *${notifiedAt}* and returned it. Your case will not be numbered until all three are cleared.`,
      ].join("\n");
}

// Scope decision (confirmed): the 3 defects themselves are the prototype's
// fixed demo scenario (cheque no. 004152 vs 004512, cheque_front.jpg, the
// 22-04-2026/25-04-2026 dates, the ₹200 fee) — reproduced verbatim/translated
// from DEFECT_SCREENS, not derived from this filing's own fields.
const DEFECT_LIST_TEXT: Record<SupportedLanguage, string> = {
  en: [
    "Here's what has to be fixed:",
    "",
    "*1. Cheque number does not match*",
    "The complaint says 004152. The cheque you uploaded reads 004512.",
    "",
    "*2. Cheque photo is not legible*",
    "The signature and the MICR line can't be read. A fresh photo is needed.",
    "",
    "*3. Corrections are out of time*",
    "They were due on 25-04-2026. Filing them now needs a petition to condone the delay, with a ₹200 application fee.",
    "",
    "I'll take you through all three.",
  ].join("\n"),
  ml: [
    "തിരുത്തേണ്ടവ:",
    "",
    "*1. ചെക്ക് നമ്പർ പൊരുത്തപ്പെടുന്നില്ല*",
    "പരാതിയിൽ 004152. അപ്‌ലോഡ് ചെയ്ത ചെക്കിൽ 004512.",
    "",
    "*2. ചെക്കിന്റെ ഫോട്ടോ വ്യക്തമല്ല*",
    "ഒപ്പും MICR ലൈനും വായിക്കാനാകുന്നില്ല. പുതിയ ഫോട്ടോ വേണം.",
    "",
    "*3. തിരുത്തലുകൾ സമയപരിധി കഴിഞ്ഞു*",
    "25-04-2026 ആയിരുന്നു അവസാന തീയതി. ഇനി കാലതാമസം ക്ഷമിക്കാനുള്ള അപേക്ഷയും ₹200 ഫീസും വേണം.",
    "",
    "മൂന്നും ഞാൻ ഒപ്പം ചെയ്യാം.",
  ].join("\n"),
};

const PLAIN_TEXT_DEFECT_ALERT_ACTIONS: Record<SupportedLanguage, string> = {
  en: ["1. Correct the defects", "", "Reply with 1."].join("\n"),
  ml: ["1. ന്യൂനതകൾ തിരുത്തുക", "", "1 എന്ന് മറുപടി നൽകുക."].join("\n"),
};

export function sendDefectAlert(
  deps: { messagingClient: TwilioMessagingClient; fromNumber: string },
  input: SendFilingDefectMessageInput,
  filing: FilingRecord,
  complainantName: string | null,
  accusedName: string | null,
): Promise<boolean> {
  return sendPlain(deps, input, renderDefectAlert(input.language, filing, complainantName, accusedName), "filing_defect_alert_send_failed");
}

export function sendDefectList(deps: { messagingClient: TwilioMessagingClient; fromNumber: string }, input: SendFilingDefectMessageInput): Promise<boolean> {
  return sendPlain(deps, input, DEFECT_LIST_TEXT[input.language], "filing_defect_list_send_failed");
}

export function sendDefectAlertActions(deps: FilingDefectSenderDeps, input: SendFilingDefectMessageInput): Promise<boolean> {
  return sendActionsWithFallback(deps, input, deps.defectAlertActionsContentSid[input.language], PLAIN_TEXT_DEFECT_ALERT_ACTIONS[input.language], "filing_defect_alert_actions");
}

/**
 * Sends the defect alert + fixed defect list + "Correct the defects" action
 * together — the one screen visit, whether entering it fresh (from
 * filing-draft-list-workflow.ts's "Simulate scrutiny defects" action) or
 * redisplaying it (filing-defect-workflow.ts, unrecognized input). Kept here
 * (a leaf module both files may import) rather than in either workflow file,
 * since the codebase's one-way phase-dependency rule forbids the earlier
 * phase's workflow (#36) from importing the later phase's workflow (#37).
 */
export async function sendDefectAlertAndList(
  deps: FilingDefectSenderDeps,
  input: SendFilingDefectMessageInput,
  filing: FilingRecord,
  complainantName: string | null,
  accusedName: string | null,
): Promise<boolean> {
  const alertDelivered = await sendDefectAlert(deps, input, filing, complainantName, accusedName);
  const listDelivered = await sendDefectList(deps, input);
  const actionsDelivered = await sendDefectAlertActions(deps, input);
  return alertDelivered && listDelivered && actionsDelivered;
}

// ---------------------------------------------------------------------------
// FILING_DEFECT_1: cheque-number correction (fixed demo note, real prompt).
// ---------------------------------------------------------------------------

const DEFECT_1_TEXT: Record<SupportedLanguage, string> = {
  en: [
    "Defect 1 of 3",
    "",
    "Complaint states cheque no. 004152. The cheque uploaded reads 004512. Correct the complaint or produce the correct cheque.",
    "",
    "Cheque number — the cheque you uploaded reads 004512.",
  ].join("\n"),
  ml: [
    "ന്യൂനത 1 / 3",
    "",
    "പരാതിയിൽ ചെക്ക് നം. 004152. അപ്‌ലോഡ് ചെയ്ത ചെക്കിൽ 004512. പരാതി തിരുത്തുകയോ ശരിയായ ചെക്ക് ഹാജരാക്കുകയോ വേണം.",
    "",
    "ചെക്ക് നമ്പർ — അപ്‌ലോഡ് ചെയ്ത ചെക്കിൽ 004512.",
  ].join("\n"),
};

const DEFECT_1_INVALID_TEXT: Record<SupportedLanguage, string> = {
  en: "Please enter the cheque number.",
  ml: "ദയവായി ചെക്ക് നമ്പർ നൽകുക.",
};

export function sendDefect1Prompt(deps: { messagingClient: TwilioMessagingClient; fromNumber: string }, input: SendFilingDefectMessageInput): Promise<boolean> {
  return sendPlain(deps, input, DEFECT_1_TEXT[input.language], "filing_defect_1_prompt_send_failed");
}

export function sendDefect1Invalid(deps: { messagingClient: TwilioMessagingClient; fromNumber: string }, input: SendFilingDefectMessageInput): Promise<boolean> {
  return sendPlain(deps, input, DEFECT_1_INVALID_TEXT[input.language], "filing_defect_1_invalid_send_failed");
}

// ---------------------------------------------------------------------------
// FILING_DEFECT_2: cheque-photo re-upload (fixed demo note; the actual
// upload instructions reuse this codebase's own #31 photo-upload wording).
// ---------------------------------------------------------------------------

const DEFECT_2_TEXT: Record<SupportedLanguage, string> = {
  en: [
    "Defect 2 of 3",
    "",
    "The signature and the MICR line cannot be read in cheque_front.jpg. Upload a clear photograph of the front of the cheque.",
    "",
    "Flat on a dark surface, in daylight, no flash. The signature and the numbers along the bottom must be readable.",
    "",
    "Send 1-2 photo(s) or PDF(s), then reply \"done\".",
  ].join("\n"),
  ml: [
    "ന്യൂനത 2 / 3",
    "",
    "cheque_front.jpg-യിൽ ഒപ്പും MICR ലൈനും വായിക്കാനാകുന്നില്ല. ചെക്കിന്റെ മുൻവശത്തിന്റെ വ്യക്തമായ ഫോട്ടോ നൽകുക.",
    "",
    "ഇരുണ്ട പ്രതലത്തിൽ പരത്തി, പകൽ വെളിച്ചത്തിൽ, ഫ്ലാഷ് ഇല്ലാതെ. ഒപ്പും താഴെയുള്ള അക്കങ്ങളും വ്യക്തമാകണം.",
    "",
    "1-2 ഫോട്ടോ അല്ലെങ്കിൽ PDF അയക്കുക, എന്നിട്ട് \"കഴിഞ്ഞു\" എന്ന് മറുപടി നൽകുക.",
  ].join("\n"),
};

export function sendDefect2Prompt(deps: { messagingClient: TwilioMessagingClient; fromNumber: string }, input: SendFilingDefectMessageInput): Promise<boolean> {
  return sendPlain(deps, input, DEFECT_2_TEXT[input.language], "filing_defect_2_prompt_send_failed");
}

// ---------------------------------------------------------------------------
// FILING_DEFECT_3: reason for delay, then days of delay.
// ---------------------------------------------------------------------------

const DEFECT_3_REASON_TEXT: Record<SupportedLanguage, string> = {
  en: [
    "Defect 3 of 3",
    "",
    "Defects were notified on 22-04-2026 and were to be cured by 25-04-2026. A petition to condone the delay must accompany the corrections, with the ₹200 application fee.",
    "",
    "Reason for delay — the court records this ground before condoning.",
  ].join("\n"),
  ml: [
    "ന്യൂനത 3 / 3",
    "",
    "22-04-2026-ന് ന്യൂനതകൾ അറിയിച്ചു, 25-04-2026-നകം തീർക്കേണ്ടതായിരുന്നു. കാലതാമസം ക്ഷമിക്കാനുള്ള അപേക്ഷയും ₹200 ഫീസും ചേർക്കണം.",
    "",
    "കാലതാമസത്തിന്റെ കാരണം — ക്ഷമിക്കുന്നതിന് മുൻപ് കോടതി ഈ കാരണം രേഖപ്പെടുത്തും.",
  ].join("\n"),
};

const DEFECT_3_REASON_INVALID_TEXT: Record<SupportedLanguage, string> = {
  en: "Please enter a reason for the delay.",
  ml: "ദയവായി കാലതാമസത്തിന്റെ കാരണം നൽകുക.",
};

const PLAIN_TEXT_DELAY_DAYS: Record<SupportedLanguage, string> = {
  en: ["Days of delay", "", "1. 2 days", "2. 3 days", "3. 5 days", "", "Reply with 1, 2, or 3."].join("\n"),
  ml: ["കാലതാമസം (ദിവസം)", "", "1. 2 ദിവസം", "2. 3 ദിവസം", "3. 5 ദിവസം", "", "1, 2, അല്ലെങ്കിൽ 3 എന്ന് മറുപടി നൽകുക."].join("\n"),
};

export function sendDefect3ReasonPrompt(deps: { messagingClient: TwilioMessagingClient; fromNumber: string }, input: SendFilingDefectMessageInput): Promise<boolean> {
  return sendPlain(deps, input, DEFECT_3_REASON_TEXT[input.language], "filing_defect_3_reason_prompt_send_failed");
}

export function sendDefect3ReasonInvalid(deps: { messagingClient: TwilioMessagingClient; fromNumber: string }, input: SendFilingDefectMessageInput): Promise<boolean> {
  return sendPlain(deps, input, DEFECT_3_REASON_INVALID_TEXT[input.language], "filing_defect_3_reason_invalid_send_failed");
}

export function sendDelayDaysPrompt(deps: FilingDefectSenderDeps, input: SendFilingDefectMessageInput): Promise<boolean> {
  return sendActionsWithFallback(deps, input, deps.delayDaysContentSid[input.language], PLAIN_TEXT_DELAY_DAYS[input.language], "filing_defect_delay_days_prompt");
}

// ---------------------------------------------------------------------------
// FILING_DEFECT_REVIEW: all 3 answers + the declaration/confirm action.
// ---------------------------------------------------------------------------

function formatDelayDays(language: SupportedLanguage, days: number | null): string {
  if (days === null) {
    return "";
  }
  return language === "ml" ? `${days} ദിവസം` : `${days} days`;
}

/** Renders the review summary from the filing's own persisted defect answers — never re-derived from the current webhook body. */
export function renderDefectReviewSummary(language: SupportedLanguage, filing: FilingRecord): string {
  return language === "ml"
    ? [
        "പരിശോധിച്ച് തിരികെ അയക്കുക",
        "",
        "മൂന്ന് ന്യൂനതകൾക്കും ഒരുമിച്ച് മറുപടി നൽകണം.",
        "",
        `ചെക്ക് നം. ${filing.defectCorrectedChequeNumber ?? ""}`,
        "പുതിയ ഫോട്ടോ: ലഭിച്ചു",
        `കാലതാമസ അപേക്ഷ (${formatDelayDays(language, filing.defectDelayDays)}) — ${filing.defectDelayReason ?? ""}`,
        "",
        "മുകളിലെ തിരുത്തലുകൾ എന്റെ അറിവിൽ സത്യവും പൂർണ്ണവുമാണ്.",
      ].join("\n")
    : [
        "Review and send back",
        "",
        "All three defects must be answered together.",
        "",
        `Cheque no. ${filing.defectCorrectedChequeNumber ?? ""}`,
        "Re-uploaded: received",
        `Delay condonation (${formatDelayDays(language, filing.defectDelayDays)}) — ${filing.defectDelayReason ?? ""}`,
        "",
        "The corrections above are true and complete to the best of my knowledge.",
      ].join("\n");
}

const PLAIN_TEXT_DEFECT_REVIEW_ACTIONS: Record<SupportedLanguage, string> = {
  en: ["1. Pay ₹200 and send back", "", "Reply with 1."].join("\n"),
  ml: ["1. ₹200 അടച്ച് തിരികെ അയക്കുക", "", "1 എന്ന് മറുപടി നൽകുക."].join("\n"),
};

export function sendDefectReviewSummary(deps: { messagingClient: TwilioMessagingClient; fromNumber: string }, input: SendFilingDefectMessageInput, filing: FilingRecord): Promise<boolean> {
  return sendPlain(deps, input, renderDefectReviewSummary(input.language, filing), "filing_defect_review_summary_send_failed");
}

export function sendDefectReviewActions(deps: FilingDefectSenderDeps, input: SendFilingDefectMessageInput): Promise<boolean> {
  return sendActionsWithFallback(deps, input, deps.defectReviewActionsContentSid[input.language], PLAIN_TEXT_DEFECT_REVIEW_ACTIONS[input.language], "filing_defect_review_actions");
}

// ---------------------------------------------------------------------------
// FILING_DEFECT_SENT: the resubmission acknowledgement.
// ---------------------------------------------------------------------------

/** Renders the resubmission acknowledgement from the filing's own persisted diaryNumber/defectResubmittedAt — never hardcoded, unlike the prototype's single-scenario demo. */
export function renderDefectSent(language: SupportedLanguage, filing: FilingRecord): string {
  const resubmittedAt = filing.defectResubmittedAt ? formatIstTimestamp(filing.defectResubmittedAt) : "";
  return language === "ml"
    ? [
        "✅ *സ്ക്രൂട്ടിനിക്ക് തിരികെ അയച്ചു*",
        "",
        `ഡയറി നം. *${filing.diaryNumber ?? ""}*`,
        `${resubmittedAt}-ന് വീണ്ടും സമർപ്പിച്ചു`,
        "",
        "മൂന്ന് ന്യൂനതകൾക്കും മറുപടി നൽകി, കാലതാമസ അപേക്ഷയും ചേർത്തു. സാധാരണ *2 പ്രവൃത്തി ദിവസത്തിനുള്ളിൽ* ഓഫീസർ പരിശോധിക്കും.",
        "",
        "സ്വീകരിച്ചാൽ കേസ് നമ്പറും ആദ്യ ഹിയറിംഗ് തീയതിയും ഇവിടെ അയക്കും.",
      ].join("\n")
    : [
        "✅ *Sent back to scrutiny*",
        "",
        `Diary no. *${filing.diaryNumber ?? ""}*`,
        `Resubmitted on ${resubmittedAt}`,
        "",
        "All three defects are marked as answered, and the condonation petition is attached. The scrutiny officer usually reviews within *2 working days*.",
        "",
        "If it's accepted, your case gets its number and a first hearing date - I will send both here.",
      ].join("\n");
}

const PLAIN_TEXT_DEFECT_SENT_ACTIONS: Record<SupportedLanguage, string> = {
  en: ["1. Main menu", "", "Reply with 1."].join("\n"),
  ml: ["1. പ്രധാന മെനു", "", "1 എന്ന് മറുപടി നൽകുക."].join("\n"),
};

export function sendDefectSent(deps: { messagingClient: TwilioMessagingClient; fromNumber: string }, input: SendFilingDefectMessageInput, filing: FilingRecord): Promise<boolean> {
  return sendPlain(deps, input, renderDefectSent(input.language, filing), "filing_defect_sent_send_failed");
}

export function sendDefectSentActions(deps: FilingDefectSenderDeps, input: SendFilingDefectMessageInput): Promise<boolean> {
  return sendActionsWithFallback(deps, input, deps.defectSentActionsContentSid[input.language], PLAIN_TEXT_DEFECT_SENT_ACTIONS[input.language], "filing_defect_sent_actions");
}
