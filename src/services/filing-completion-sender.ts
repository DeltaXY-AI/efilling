import type { TwilioMessagingClient } from "../adapters/twilio/messaging-client";
import type { FilingRecord } from "../repositories/filing-repository";
import { formatIstTimestamp } from "../lib/format-ist-date";
import { logWorkflowError } from "../lib/logger";
import type { SupportedLanguage } from "./main-menu-sender";

/**
 * Sends and copy for #35 (Prototype parity — Phase 7): the filed
 * acknowledgement (diary number, court, filed timestamp — every value read
 * from the filing's own persisted fields, never hardcoded), its "Pay court
 * fee" Content Template, the simulated fee-paid receipt, and the final
 * completion message.
 */
export interface FilingCompletionSenderDeps {
  messagingClient: TwilioMessagingClient;
  fromNumber: string;
  payFeeActionsContentSid: Record<SupportedLanguage, string>;
}

export interface SendFilingCompletionMessageInput {
  to: string;
  language: SupportedLanguage;
  /** Twilio MessageSid, used only for safe error correlation — never logged with content. */
  correlationId: string;
}

const COURT_FEE_TEXT: Record<SupportedLanguage, string> = { en: "Rs. 500", ml: "₹500" };

/** Renders the filed acknowledgement from the filing's own persisted diaryNumber/selectedCourt/filedAt — never hardcoded, unlike the prototype's single-scenario demo. Pure formatting; never logged. */
export function renderFiledSummary(language: SupportedLanguage, filing: FilingRecord): string {
  const filedAt = filing.filedAt ? formatIstTimestamp(filing.filedAt) : "";
  return language === "ml"
    ? [
        "🎉 ഫയൽ ചെയ്തു",
        "",
        `ഡയറി നമ്പർ: ${filing.diaryNumber ?? ""}`,
        `കോടതി: ${filing.selectedCourt ?? ""}`,
        `ഫയൽ ചെയ്ത തീയതി: ${filedAt}`,
        "",
        "സൂക്ഷ്മപരിശോധനയ്ക്ക് സാധാരണയായി 2-3 പ്രവൃത്തി ദിവസങ്ങൾ എടുക്കും. കേസ് നമ്പർ അനുവദിച്ചാലോ രജിസ്ട്രി പോരായ്മ ചൂണ്ടിക്കാട്ടിയാലോ ഉടൻ ഞാൻ അറിയിക്കും.",
        "",
        `ഫയലിംഗ് പൂർത്തിയാക്കാൻ ${COURT_FEE_TEXT.ml} കോടതി ഫീസ് അടയ്ക്കുക.`,
      ].join("\n")
    : [
        "🎉 Filed successfully",
        "",
        `Diary no. ${filing.diaryNumber ?? ""}`,
        `Court: ${filing.selectedCourt ?? ""}`,
        `Filed on: ${filedAt}`,
        "",
        "Scrutiny usually takes 2-3 working days. I will message you the moment the case number is allotted or if the registry raises a defect.",
        "",
        `Pay the court fee of ${COURT_FEE_TEXT.en} to complete the filing.`,
      ].join("\n");
}

/** Renders the simulated fee-paid receipt from the filing's own persisted diaryNumber/courtFeeTransactionId/courtFeePaidAt. The transaction ID is a fabricated demo value (see filing-completion-workflow.ts) — never a real payment gateway reference. */
export function renderFeePaidMessage(language: SupportedLanguage, filing: FilingRecord): string {
  const paidAt = filing.courtFeePaidAt ? formatIstTimestamp(filing.courtFeePaidAt) : "";
  return language === "ml"
    ? [
        "✅ കോടതി ഫീസ് അടച്ചു",
        "",
        `ഡയറി നമ്പർ ${filing.diaryNumber ?? ""}-ലേക്കുള്ള കോടതി ഫീസായി ${COURT_FEE_TEXT.ml} ലഭിച്ചു.`,
        "",
        `ഇടപാട് ഐഡി: ${filing.courtFeeTransactionId ?? ""}`,
        `അടച്ച തീയതി: ${paidAt}`,
        "മോഡ്: UPI",
      ].join("\n")
    : [
        "✅ Court fee paid",
        "",
        `${COURT_FEE_TEXT.en} received towards the court fee in diary no. ${filing.diaryNumber ?? ""}.`,
        "",
        `Transaction ID: ${filing.courtFeeTransactionId ?? ""}`,
        `Paid on: ${paidAt}`,
        "Mode: UPI",
      ].join("\n");
}

// The prototype's filingDone text (PR.md Appendix A.8) ends with "You can
// check progress any time under My cases" — reworded here since Prototype
// parity Phase 8 (#36, the real "My cases"/case-status flow) doesn't exist
// yet and #29's stub explicitly tells the advocate it isn't ready. Pointing
// to it here would immediately disappoint. Flagged in the implementing PR
// per the issue's own instruction to note this ordering dependency.
const FILING_DONE_TEXT: Record<SupportedLanguage, string> = {
  en: [
    "🎉 Your filing is complete",
    "",
    "Nothing more is needed from you right now. Here is what happens next:",
    "",
    "1️⃣ The registry scrutinises the complaint - 2 to 3 working days",
    "2️⃣ If anything is missing, I will message you with exactly what to fix",
    "3️⃣ Once numbered, you will get the case number and the first hearing date here",
    "",
    "You will be notified here as your filing progresses - no need to check anywhere else for now.",
  ].join("\n"),
  ml: [
    "🎉 നിങ്ങളുടെ ഫയലിംഗ് പൂർത്തിയായി",
    "",
    "ഇപ്പോൾ നിങ്ങളിൽ നിന്ന് ഒന്നും ആവശ്യമില്ല. അടുത്തതായി എന്ത് സംഭവിക്കും എന്നത് ഇതാ:",
    "",
    "1️⃣ രജിസ്ട്രി പരാതി പരിശോധിക്കും - 2 മുതൽ 3 പ്രവൃത്തി ദിവസം",
    "2️⃣ എന്തെങ്കിലും കുറവുണ്ടെങ്കിൽ, കൃത്യമായി എന്താണ് ശരിയാക്കേണ്ടതെന്ന് ഞാൻ അറിയിക്കും",
    "3️⃣ നമ്പർ അനുവദിച്ചു കഴിഞ്ഞാൽ, കേസ് നമ്പറും ആദ്യ ഹിയറിംഗ് തീയതിയും ഇവിടെ ലഭിക്കും",
    "",
    "നിങ്ങളുടെ ഫയലിംഗ് പുരോഗമിക്കുന്നതനുസരിച്ച് ഞാൻ ഇവിടെ അറിയിക്കും - മറ്റെവിടെയും പരിശോധിക്കേണ്ട ആവശ്യമില്ല.",
  ].join("\n"),
};

export function renderFilingDoneMessage(language: SupportedLanguage): string {
  return FILING_DONE_TEXT[language];
}

const PLAIN_TEXT_PAY_FEE_ACTIONS: Record<SupportedLanguage, string> = {
  en: ["1. Pay court fee", "", "Reply with 1."].join("\n"),
  ml: ["1. കോടതി ഫീസ് അടയ്ക്കുക", "", "1 എന്ന് മറുപടി നൽകുക."].join("\n"),
};

/** Sends the persisted filed-acknowledgement summary as a plain message — no Content Template, never the current webhook body. */
export async function sendFiledSummary(
  deps: { messagingClient: TwilioMessagingClient; fromNumber: string },
  input: SendFilingCompletionMessageInput,
  filing: FilingRecord,
): Promise<boolean> {
  try {
    await deps.messagingClient.sendText({ from: deps.fromNumber, to: input.to, body: renderFiledSummary(input.language, filing) });
    return true;
  } catch {
    logWorkflowError({ code: "filing_filed_summary_send_failed", correlationId: input.correlationId });
    return false;
  }
}

/** Sends the localized "Pay court fee" Content Template, falling back to the numbered plain-text option. */
export async function sendFiledActions(deps: FilingCompletionSenderDeps, input: SendFilingCompletionMessageInput): Promise<boolean> {
  try {
    await deps.messagingClient.sendContentTemplate({ from: deps.fromNumber, to: input.to, contentSid: deps.payFeeActionsContentSid[input.language] });
    return true;
  } catch {
    logWorkflowError({ code: "filing_filed_actions_content_send_failed", correlationId: input.correlationId });

    try {
      await deps.messagingClient.sendText({ from: deps.fromNumber, to: input.to, body: PLAIN_TEXT_PAY_FEE_ACTIONS[input.language] });
      return true;
    } catch {
      logWorkflowError({ code: "filing_filed_actions_fallback_send_failed", correlationId: input.correlationId });
      return false;
    }
  }
}

/** Sends the simulated fee-paid receipt as a plain message — no Content Template. */
export async function sendFeePaidMessage(
  deps: { messagingClient: TwilioMessagingClient; fromNumber: string },
  input: SendFilingCompletionMessageInput,
  filing: FilingRecord,
): Promise<boolean> {
  try {
    await deps.messagingClient.sendText({ from: deps.fromNumber, to: input.to, body: renderFeePaidMessage(input.language, filing) });
    return true;
  } catch {
    logWorkflowError({ code: "filing_fee_paid_message_send_failed", correlationId: input.correlationId });
    return false;
  }
}

/** Sends the final completion message as a plain message — no Content Template, no actions (the next transition fires on any subsequent input). */
export async function sendFilingDoneMessage(
  deps: { messagingClient: TwilioMessagingClient; fromNumber: string },
  input: SendFilingCompletionMessageInput,
): Promise<boolean> {
  try {
    await deps.messagingClient.sendText({ from: deps.fromNumber, to: input.to, body: renderFilingDoneMessage(input.language) });
    return true;
  } catch {
    logWorkflowError({ code: "filing_done_message_send_failed", correlationId: input.correlationId });
    return false;
  }
}
