import type { TwilioMessagingClient } from "../adapters/twilio/messaging-client";
import { logWorkflowError } from "../lib/logger";
import type { SupportedLanguage } from "./main-menu-sender";

export interface FilingSenderDeps {
  messagingClient: TwilioMessagingClient;
  fromNumber: string;
  draftChoiceContentSid: Record<SupportedLanguage, string>;
  noticeContentSid: Record<SupportedLanguage, string>;
  /**
   * The "Done"/"Add sample files" quick-reply buttons, threaded through to
   * filing-document-workflow.ts's sendFilingDocChequePrompt/
   * resendFilingDocumentPromptForResume — this file has no template of its
   * own for it. `undefined` until provisioned, in which case those fall
   * back to their original plain-text prompts, unchanged.
   */
  continueSampleContentSid?: Record<SupportedLanguage, string>;
}

export interface SendFilingMessageInput {
  to: string;
  language: SupportedLanguage;
  /** Twilio MessageSid, used only for safe error correlation — never logged with content. */
  correlationId: string;
}

const PLAIN_TEXT_DRAFT_CHOICE: Record<SupportedLanguage, string> = {
  en: ["You have a saved filing draft.", "", "1. Resume draft", "2. Start new filing", "3. Main menu", "", "Reply with 1, 2, or 3."].join(
    "\n",
  ),
  ml: [
    "നിങ്ങൾക്ക് സേവ് ചെയ്ത ഒരു ഫയലിംഗ് ഡ്രാഫ്റ്റ് ഉണ്ട്.",
    "",
    "1. ഡ്രാഫ്റ്റ് തുടരുക",
    "2. പുതിയ ഫയലിംഗ് ആരംഭിക്കുക",
    "3. പ്രധാന മെനു",
    "",
    "1, 2, അല്ലെങ്കിൽ 3 എന്ന് മറുപടി നൽകുക.",
  ].join("\n"),
};

// #30: replaces the old generic demo disclaimer with the prototype's
// pre-filing document checklist (PR.md Appendix A.3) — content only, the
// state machine/payloads below are unchanged from #8.
const PLAIN_TEXT_NOTICE: Record<SupportedLanguage, string> = {
  en: [
    "⚖️ Cheque bounce complaint — S.138, NI Act",
    "",
    "Before we start, please keep these ready as photos or PDFs:",
    "",
    "• Cheque — front and back",
    "• Cheque return / dishonour memo from the bank",
    "• Demand notice sent to the accused",
    "• Postal receipt and acknowledgement card",
    "• Reply to the notice, if you received one",
    "• Proof of the debt — invoice, agreement or receipt",
    "• Your ID proof — Aadhaar or PAN",
    "• Vakalatnama, if an advocate is filing for you",
    "",
    "⏱️ It takes about 7 minutes. You can stop midway — your draft is saved.",
    "",
    "1. Start filing",
    "2. Main menu",
  ].join("\n"),
  ml: [
    "⚖️ ചെക്ക് മടങ്ങിയ കേസ് — NI ആക്ട് വകുപ്പ് 138",
    "",
    "ആരംഭിക്കുന്നതിന് മുൻപ് താഴെ പറയുന്ന രേഖകൾ ഫോട്ടോ അല്ലെങ്കിൽ PDF ആയി തയ്യാറാക്കി വെക്കുക:",
    "",
    "• ചെക്ക് — മുൻവശവും പിൻവശവും",
    "• ബാങ്കിൽ നിന്നുള്ള ചെക്ക് മടക്ക മെമ്മോ",
    "• എതിർകക്ഷിക്ക് അയച്ച ഡിമാൻഡ് നോട്ടീസ്",
    "• തപാൽ രസീതും അക്നോളജ്‌മെന്റ് കാർഡും",
    "• നോട്ടീസിന് മറുപടി ലഭിച്ചിട്ടുണ്ടെങ്കിൽ അത്",
    "• കടം തെളിയിക്കുന്ന രേഖ — ഇൻവോയ്സ്, കരാർ, രസീത്",
    "• നിങ്ങളുടെ തിരിച്ചറിയൽ രേഖ — ആധാർ അല്ലെങ്കിൽ പാൻ",
    "• അഭിഭാഷകൻ മുഖേനയാണെങ്കിൽ വക്കാലത്ത്",
    "",
    "⏱️ ഏകദേശം 7 മിനിറ്റ് മതി. ഇടയ്ക്ക് നിർത്തിയാലും ഡ്രാഫ്റ്റ് സേവ് ചെയ്യപ്പെടും.",
    "",
    "1. ഫയലിംഗ് ആരംഭിക്കുക",
    "2. പ്രധാന മെനു",
  ].join("\n"),
};

async function sendWithFallback(
  deps: { messagingClient: TwilioMessagingClient; fromNumber: string },
  input: SendFilingMessageInput,
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

/** Sends the localized draft-choice Content Template, falling back to the numbered plain-text menu. */
export function sendDraftChoice(deps: FilingSenderDeps, input: SendFilingMessageInput): Promise<boolean> {
  return sendWithFallback(
    deps,
    input,
    deps.draftChoiceContentSid[input.language],
    PLAIN_TEXT_DRAFT_CHOICE[input.language],
    "filing_draft_choice",
  );
}

/** Sends the localized test-data-notice Content Template, falling back to the numbered plain-text menu. */
export function sendFilingNotice(deps: FilingSenderDeps, input: SendFilingMessageInput): Promise<boolean> {
  return sendWithFallback(deps, input, deps.noticeContentSid[input.language], PLAIN_TEXT_NOTICE[input.language], "filing_notice");
}

/** Sends a plain informational message (no buttons) — used for resume/support/completion messages. */
export async function sendFilingPlainText(
  deps: { messagingClient: TwilioMessagingClient; fromNumber: string },
  input: SendFilingMessageInput,
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

/**
 * Sends a quick-reply Content Template whose body is the caller's own
 * dynamic text (via contentVariables `{"1": body}`), for prompts/errors
 * whose copy lives in the calling workflow file rather than a template —
 * e.g. an optional field's "Skip" button, or the document-upload flow's
 * "Done"/"Add sample files" buttons. Falls back to the exact same text with
 * no buttons if the template send itself fails.
 */
async function sendFilingQuickReply(
  deps: { messagingClient: TwilioMessagingClient; fromNumber: string },
  input: SendFilingMessageInput,
  contentSid: string,
  body: string,
  errorCode: string,
): Promise<boolean> {
  try {
    await deps.messagingClient.sendContentTemplate({
      from: deps.fromNumber,
      to: input.to,
      contentSid,
      contentVariables: { "1": body },
    });
    return true;
  } catch {
    logWorkflowError({ code: `${errorCode}_content_send_failed`, correlationId: input.correlationId });
    return sendFilingPlainText(deps, input, body, `${errorCode}_fallback_send_failed`);
  }
}

/**
 * The button-vs-plain-text switch every optional-field/continue prompt in
 * this codebase goes through: `contentSid` is `undefined` until its Content
 * Template has actually been provisioned in Twilio and its SID configured
 * (see .env.example) — until then this sends the exact same plain text it
 * always has, byte for byte, so the button rollout is purely additive and
 * never a behavior change on its own.
 */
export function sendFilingPromptWithOptionalButton(
  deps: { messagingClient: TwilioMessagingClient; fromNumber: string },
  input: SendFilingMessageInput,
  contentSid: string | undefined,
  body: string,
  errorCode: string,
): Promise<boolean> {
  if (!contentSid) {
    return sendFilingPlainText(deps, input, body, errorCode);
  }
  return sendFilingQuickReply(deps, input, contentSid, body, errorCode);
}
