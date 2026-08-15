import type { TwilioMessagingClient } from "../adapters/twilio/messaging-client";
import type { FilingRecord } from "../repositories/filing-repository";
import { logWorkflowError } from "../lib/logger";
import type { SupportedLanguage } from "./main-menu-sender";

/**
 * Sends and copy for #34 (Prototype parity — Phase 6): the draft-ready
 * summary (plain text, rendered from the filing's own persisted fields —
 * never a hardcoded court) and its "Review & e-Sign"/"Edit details"
 * Content Template. The OTP prompt/error have no Content Template and are
 * sent with the generic `sendFilingPlainText` helper directly from
 * filing-sign-workflow.ts, which also owns their copy.
 */
export interface FilingSignSenderDeps {
  messagingClient: TwilioMessagingClient;
  fromNumber: string;
  draftReadyActionsContentSid: Record<SupportedLanguage, string>;
}

export interface SendFilingSignMessageInput {
  to: string;
  language: SupportedLanguage;
  /** Twilio MessageSid, used only for safe error correlation — never logged with content. */
  correlationId: string;
}

const DRAFT_READY_LABELS: Record<SupportedLanguage, { title: string; body: string; court: string; fee: string }> = {
  en: {
    title: "✅ Your complaint is ready",
    body: "I have drafted the complaint under S.138 of the NI Act with the sworn statement and the list of documents, and picked the court with jurisdiction.",
    court: "Court",
    fee: "Court fee payable",
  },
  ml: {
    title: "✅ നിങ്ങളുടെ പരാതി തയ്യാറാണ്",
    body: "സത്യവാങ്മൂലവും രേഖകളുടെ പട്ടികയും സഹിതം NI ആക്ട് വകുപ്പ് 138 പ്രകാരം പരാതി തയ്യാറാക്കി, അധികാരപരിധിയുള്ള കോടതി തിരഞ്ഞെടുത്തു.",
    court: "കോടതി",
    fee: "അടയ്‌ക്കേണ്ട കോടതി ഫീസ്",
  },
};

// The flat court fee is a fixed value in the prototype (never collected in
// Phase 5), unlike the court itself — see renderDraftReadySummary below.
const COURT_FEE_TEXT: Record<SupportedLanguage, string> = {
  en: "Rs. 500",
  ml: "₹500",
};

/**
 * Renders the draft-ready summary from the filing's own persisted
 * `selectedCourt` (Phase 5 Part F) — never a hardcoded court, unlike the
 * prototype's single-scenario demo. Pure formatting; never logged.
 */
export function renderDraftReadySummary(language: SupportedLanguage, filing: FilingRecord): string {
  const labels = DRAFT_READY_LABELS[language];
  return [labels.title, "", labels.body, "", `${labels.court}: ${filing.selectedCourt ?? ""}`, `${labels.fee}: ${COURT_FEE_TEXT[language]}`].join("\n");
}

const PLAIN_TEXT_DRAFT_READY_ACTIONS: Record<SupportedLanguage, string> = {
  en: ["1. Review & e-Sign", "2. Edit details", "", "Reply with 1 or 2."].join("\n"),
  ml: ["1. അവലോകനം ചെയ്ത് ഇ-സൈൻ ചെയ്യുക", "2. വിവരങ്ങൾ എഡിറ്റ് ചെയ്യുക", "", "1 അല്ലെങ്കിൽ 2 എന്ന് മറുപടി നൽകുക."].join("\n"),
};

/** Sends the persisted draft-ready summary as a plain message — no Content Template, never the current webhook body. */
export async function sendDraftReadySummary(
  deps: { messagingClient: TwilioMessagingClient; fromNumber: string },
  input: SendFilingSignMessageInput,
  filing: FilingRecord,
): Promise<boolean> {
  try {
    await deps.messagingClient.sendText({ from: deps.fromNumber, to: input.to, body: renderDraftReadySummary(input.language, filing) });
    return true;
  } catch {
    logWorkflowError({ code: "filing_draft_ready_summary_send_failed", correlationId: input.correlationId });
    return false;
  }
}

/** Sends the localized "Review & e-Sign / Edit details" Content Template, falling back to the numbered plain-text options. */
export async function sendDraftReadyActions(deps: FilingSignSenderDeps, input: SendFilingSignMessageInput): Promise<boolean> {
  try {
    await deps.messagingClient.sendContentTemplate({ from: deps.fromNumber, to: input.to, contentSid: deps.draftReadyActionsContentSid[input.language] });
    return true;
  } catch {
    logWorkflowError({ code: "filing_draft_ready_actions_content_send_failed", correlationId: input.correlationId });

    try {
      await deps.messagingClient.sendText({ from: deps.fromNumber, to: input.to, body: PLAIN_TEXT_DRAFT_READY_ACTIONS[input.language] });
      return true;
    } catch {
      logWorkflowError({ code: "filing_draft_ready_actions_fallback_send_failed", correlationId: input.correlationId });
      return false;
    }
  }
}
