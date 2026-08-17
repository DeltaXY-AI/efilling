import type { TwilioMessagingClient } from "../adapters/twilio/messaging-client";
import { logWorkflowError } from "../lib/logger";
import type { SupportedLanguage } from "./main-menu-sender";

/**
 * Case-type gating (inserted before #8's FILING_NOTICE): the top-level
 * Cheque-bounce/Other-case-types prompt, and the full 5-item "Case types"
 * list opened from "Other case types". Mirrors filing-sender.ts's shape
 * exactly — a Content Template with a plain-text fallback for each screen.
 */

export interface CaseTypeSenderDeps {
  messagingClient: TwilioMessagingClient;
  fromNumber: string;
  caseTypePromptContentSid: Record<SupportedLanguage, string>;
  otherCaseTypesContentSid: Record<SupportedLanguage, string>;
}

export interface SendCaseTypeMessageInput {
  to: string;
  language: SupportedLanguage;
  /** Twilio MessageSid, used only for safe error correlation — never logged with content. */
  correlationId: string;
}

const PLAIN_TEXT_CASE_TYPE: Record<SupportedLanguage, string> = {
  en: ["What kind of case is it?", "", "1. Cheque bounce (S.138)", "2. Other case types", "", "Reply with 1 or 2."].join("\n"),
  ml: ["ഏത് തരം കേസ് ആണ്?", "", "1. ചെക്ക് മടങ്ങൽ (വകുപ്പ് 138)", "2. മറ്റ് കേസ് തരങ്ങൾ", "", "1 അല്ലെങ്കിൽ 2 എന്ന് മറുപടി നൽകുക."].join("\n"),
};

const PLAIN_TEXT_OTHER_CASE_TYPES: Record<SupportedLanguage, string> = {
  en: [
    "Choose a case type to see where it's handled.",
    "",
    "1. Cheque bounce — S.138 NI Act, filed here",
    "2. Money recovery — Munsiff Court",
    "3. Rent and eviction — Rent Control Court, Kollam",
    "4. Consumer complaint — District Consumer Commission",
    "5. Matrimonial — Family Court, Kollam",
    "",
    "Reply with 1, 2, 3, 4, or 5.",
  ].join("\n"),
  ml: [
    "ഒരു കേസ് തരം തിരഞ്ഞെടുക്കുക, അത് എവിടെ കൈകാര്യം ചെയ്യുന്നു എന്ന് അറിയാൻ.",
    "",
    "1. ചെക്ക് മടങ്ങൽ — വകുപ്പ് 138, ഇവിടെ ഫയൽ ചെയ്യാം",
    "2. പണം തിരികെ വാങ്ങൽ — മുൻസിഫ് കോടതി",
    "3. വാടകയും കുടിയൊഴിപ്പിക്കലും — റെന്റ് കൺട്രോൾ കോടതി, കൊല്ലം",
    "4. ഉപഭോക്തൃ പരാതി — ജില്ലാ ഉപഭോക്തൃ കമ്മീഷൻ",
    "5. വൈവാഹികം — കുടുംബ കോടതി, കൊല്ലം",
    "",
    "1, 2, 3, 4, അല്ലെങ്കിൽ 5 എന്ന് മറുപടി നൽകുക.",
  ].join("\n"),
};

async function sendWithFallback(
  deps: { messagingClient: TwilioMessagingClient; fromNumber: string },
  input: SendCaseTypeMessageInput,
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

/** Sends the localized top-level Cheque-bounce/Other-case-types Content Template, falling back to numbered plain text. */
export function sendCaseTypePrompt(deps: CaseTypeSenderDeps, input: SendCaseTypeMessageInput): Promise<boolean> {
  return sendWithFallback(deps, input, deps.caseTypePromptContentSid[input.language], PLAIN_TEXT_CASE_TYPE[input.language], "filing_case_type_prompt");
}

/** Sends the localized full 5-item "Case types" list Content Template, falling back to numbered plain text. */
export function sendOtherCaseTypesList(deps: CaseTypeSenderDeps, input: SendCaseTypeMessageInput): Promise<boolean> {
  return sendWithFallback(
    deps,
    input,
    deps.otherCaseTypesContentSid[input.language],
    PLAIN_TEXT_OTHER_CASE_TYPES[input.language],
    "filing_other_case_types_prompt",
  );
}
