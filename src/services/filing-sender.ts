import type { TwilioMessagingClient } from "../adapters/twilio/messaging-client";
import { logWorkflowError } from "../lib/logger";
import type { SupportedLanguage } from "./main-menu-sender";

export interface FilingSenderDeps {
  messagingClient: TwilioMessagingClient;
  fromNumber: string;
  draftChoiceContentSid: Record<SupportedLanguage, string>;
  noticeContentSid: Record<SupportedLanguage, string>;
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

const PLAIN_TEXT_NOTICE: Record<SupportedLanguage, string> = {
  en: [
    "This is a demonstration service. Use anonymized test data only.",
    "",
    "Continuing will not file a real case with any court.",
    "",
    "1. Continue",
    "2. Main menu",
  ].join("\n"),
  ml: [
    "ഇത് ഒരു ഡെമോൺസ്ട്രേഷൻ സേവനമാണ്. അജ്ഞാതമാക്കിയ ടെസ്റ്റ് ഡാറ്റ മാത്രം ഉപയോഗിക്കുക.",
    "",
    "തുടരുന്നത് ഏതെങ്കിലും കോടതിയിൽ യഥാർത്ഥ കേസ് ഫയൽ ചെയ്യില്ല.",
    "",
    "1. തുടരുക",
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
