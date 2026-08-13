import type { TwilioMessagingClient } from "../adapters/twilio/messaging-client";
import { logWorkflowError } from "../lib/logger";
import type { SupportedLanguage } from "./main-menu-sender";

export interface EnrolmentSenderDeps {
  messagingClient: TwilioMessagingClient;
  fromNumber: string;
  promptContentSid: Record<SupportedLanguage, string>;
  confirmContentSid: Record<SupportedLanguage, string>;
}

export interface SendEnrolmentMessageInput {
  to: string;
  language: SupportedLanguage;
  /** Twilio MessageSid, used only for safe error correlation — never logged with content. */
  correlationId: string;
}

// #9 Part D. The enrolment number itself is never included in a fallback
// text template constant — it is only ever interpolated at send time from
// an already-validated/normalized value, never logged.
const PLAIN_TEXT_PROMPT: Record<SupportedLanguage, string> = {
  en: [
    "Enter your advocate enrolment number.",
    "",
    "Example: KER/1234/2010",
    "",
    "For this demonstration, the number will be recorded but not verified with a Bar Council.",
  ].join("\n"),
  ml: [
    "നിങ്ങളുടെ അഭിഭാഷക എൻറോൾമെന്റ് നമ്പർ നൽകുക.",
    "",
    "ഉദാഹരണം: KER/1234/2010",
    "",
    "ഈ ഡെമോയിൽ നമ്പർ രേഖപ്പെടുത്തും, പക്ഷേ ബാർ കൗൺസിലുമായി പരിശോധിക്കില്ല.",
  ].join("\n"),
};

// #9 Part J: on a confirmation Content Template failure, fallback text must
// still show the normalized number and accept exact numbered responses.
function plainTextConfirmation(language: SupportedLanguage, normalizedNumber: string): string {
  const lines: Record<SupportedLanguage, string[]> = {
    en: [
      `Advocate enrolment number: ${normalizedNumber}`,
      "",
      "This number will be recorded for the demonstration. It has not been verified with a Bar Council.",
      "",
      "1. Confirm",
      "2. Edit",
      "3. Save and exit",
      "",
      "Reply with 1, 2, or 3.",
    ],
    ml: [
      `അഭിഭാഷക എൻറോൾമെന്റ് നമ്പർ: ${normalizedNumber}`,
      "",
      "ഈ നമ്പർ ഡെമോൺസ്ട്രേഷനായി രേഖപ്പെടുത്തും. ഇത് ബാർ കൗൺസിലുമായി പരിശോധിച്ചിട്ടില്ല.",
      "",
      "1. സ്ഥിരീകരിക്കുക",
      "2. എഡിറ്റ് ചെയ്യുക",
      "3. സേവ് ചെയ്ത് പുറത്തുപോകുക",
      "",
      "1, 2, അല്ലെങ്കിൽ 3 എന്ന് മറുപടി നൽകുക.",
    ],
  };
  return lines[language].join("\n");
}

/** Sends the localized enrolment-prompt Content Template (twilio/text), falling back to plain text. Entering/re-entering ADVOCATE_ENROLMENT_PENDING always sends this (#9 Part D/H). */
export async function sendEnrolmentPrompt(deps: EnrolmentSenderDeps, input: SendEnrolmentMessageInput): Promise<boolean> {
  try {
    await deps.messagingClient.sendContentTemplate({
      from: deps.fromNumber,
      to: input.to,
      contentSid: deps.promptContentSid[input.language],
    });
    return true;
  } catch {
    logWorkflowError({ code: "enrolment_prompt_content_send_failed", correlationId: input.correlationId });

    try {
      await deps.messagingClient.sendText({ from: deps.fromNumber, to: input.to, body: PLAIN_TEXT_PROMPT[input.language] });
      return true;
    } catch {
      logWorkflowError({ code: "enrolment_prompt_fallback_send_failed", correlationId: input.correlationId });
      return false;
    }
  }
}

/**
 * Sends the localized enrolment-confirmation Content Template
 * (twilio/quick-reply) with the normalized number as its `{{1}}` variable,
 * falling back to plain text with the same numbered options (#9 Part
 * E/J). `normalizedNumber` is never logged — only ever passed through to
 * the send itself.
 */
export async function sendEnrolmentConfirmation(
  deps: EnrolmentSenderDeps,
  input: SendEnrolmentMessageInput,
  normalizedNumber: string,
): Promise<boolean> {
  try {
    await deps.messagingClient.sendContentTemplate({
      from: deps.fromNumber,
      to: input.to,
      contentSid: deps.confirmContentSid[input.language],
      contentVariables: { "1": normalizedNumber },
    });
    return true;
  } catch {
    logWorkflowError({ code: "enrolment_confirm_content_send_failed", correlationId: input.correlationId });

    try {
      await deps.messagingClient.sendText({
        from: deps.fromNumber,
        to: input.to,
        body: plainTextConfirmation(input.language, normalizedNumber),
      });
      return true;
    } catch {
      logWorkflowError({ code: "enrolment_confirm_fallback_send_failed", correlationId: input.correlationId });
      return false;
    }
  }
}
