import type { InteractiveButton, MessagingClient } from "../types/messaging-client";
import { logWorkflowError } from "../lib/logger";
import type { SupportedLanguage } from "./main-menu-sender";

export interface FilingSenderDeps {
  messagingClient: MessagingClient;
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

// Interactive body text (the lead sentence, before the numbered options —
// Meta's interactive body has a generous 1024-char limit, no truncation
// risk here). Button titles reuse the shorter phrases already established
// in domain/filing.ts's *_TEXT_TO_ACTION maps for these exact actions,
// rather than a new translation invented here — same reasoning as
// main-menu-sender.ts. "പുതിയ ഫയലിംഗ് ആരംഭിക്കുക" may still exceed Meta's
// 20-character button-title limit; if so the send throws and the existing
// Content Template / plain-text fallback below takes over.
const INTERACTIVE_DRAFT_CHOICE_BODY: Record<SupportedLanguage, string> = {
  en: "You have a saved filing draft.",
  ml: "നിങ്ങൾക്ക് സേവ് ചെയ്ത ഒരു ഫയലിംഗ് ഡ്രാഫ്റ്റ് ഉണ്ട്.",
};

const INTERACTIVE_DRAFT_CHOICE_BUTTONS: Record<SupportedLanguage, InteractiveButton[]> = {
  en: [
    { id: "filing:resume-draft", title: "Resume draft" },
    { id: "filing:start-new", title: "Start new filing" },
    { id: "nav:main-menu", title: "Main menu" },
  ],
  ml: [
    { id: "filing:resume-draft", title: "ഡ്രാഫ്റ്റ് തുടരുക" },
    { id: "filing:start-new", title: "പുതിയ ഫയലിംഗ് ആരംഭിക്കുക" },
    { id: "nav:main-menu", title: "പ്രധാന മെനു" },
  ],
};

const INTERACTIVE_NOTICE_BODY: Record<SupportedLanguage, string> = {
  en: "This is a demonstration service. Use anonymized test data only.\n\nContinuing will not file a real case with any court.",
  ml: "ഇത് ഒരു ഡെമോൺസ്ട്രേഷൻ സേവനമാണ്. അജ്ഞാതമാക്കിയ ടെസ്റ്റ് ഡാറ്റ മാത്രം ഉപയോഗിക്കുക.\n\nതുടരുന്നത് ഏതെങ്കിലും കോടതിയിൽ യഥാർത്ഥ കേസ് ഫയൽ ചെയ്യില്ല.",
};

const INTERACTIVE_NOTICE_BUTTONS: Record<SupportedLanguage, InteractiveButton[]> = {
  en: [
    { id: "filing:accept-test-notice", title: "Continue" },
    { id: "nav:main-menu", title: "Main menu" },
  ],
  ml: [
    { id: "filing:accept-test-notice", title: "തുടരുക" },
    { id: "nav:main-menu", title: "പ്രധാന മെനു" },
  ],
};

interface InteractiveButtonsSend {
  bodyText: string;
  buttons: InteractiveButton[];
}

/**
 * Sends via a provider's native interactive buttons when available (Kapso
 * — #16 task 6), then the Content Template (Twilio), then the numbered
 * plain-text fallback. Never surfaces a provider's internal error to the
 * advocate.
 */
async function sendWithFallback(
  deps: { messagingClient: MessagingClient; fromNumber: string },
  input: SendFilingMessageInput,
  contentSid: string,
  fallbackText: string,
  codePrefix: string,
  interactive?: InteractiveButtonsSend,
): Promise<boolean> {
  if (interactive && deps.messagingClient.sendInteractiveButtons) {
    try {
      await deps.messagingClient.sendInteractiveButtons({
        from: deps.fromNumber,
        to: input.to,
        bodyText: interactive.bodyText,
        buttons: interactive.buttons,
      });
      return true;
    } catch {
      logWorkflowError({ code: `${codePrefix}_interactive_send_failed`, correlationId: input.correlationId });
      // Falls through to the Content Template / plain-text path below.
    }
  }

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

/** Sends the localized draft-choice message, preferring native interactive buttons, then Content Template, then plain text. */
export function sendDraftChoice(deps: FilingSenderDeps, input: SendFilingMessageInput): Promise<boolean> {
  return sendWithFallback(
    deps,
    input,
    deps.draftChoiceContentSid[input.language],
    PLAIN_TEXT_DRAFT_CHOICE[input.language],
    "filing_draft_choice",
    { bodyText: INTERACTIVE_DRAFT_CHOICE_BODY[input.language], buttons: INTERACTIVE_DRAFT_CHOICE_BUTTONS[input.language] },
  );
}

/** Sends the localized test-data-notice message, preferring native interactive buttons, then Content Template, then plain text. */
export function sendFilingNotice(deps: FilingSenderDeps, input: SendFilingMessageInput): Promise<boolean> {
  return sendWithFallback(
    deps,
    input,
    deps.noticeContentSid[input.language],
    PLAIN_TEXT_NOTICE[input.language],
    "filing_notice",
    { bodyText: INTERACTIVE_NOTICE_BODY[input.language], buttons: INTERACTIVE_NOTICE_BUTTONS[input.language] },
  );
}

/** Sends a plain informational message (no buttons) — used for resume/support/completion messages. */
export async function sendFilingPlainText(
  deps: { messagingClient: MessagingClient; fromNumber: string },
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
