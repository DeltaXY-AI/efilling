import type { TwilioMessagingClient } from "../adapters/twilio/messaging-client";
import { logWorkflowError } from "../lib/logger";
import type { LanguageCode } from "../domain/language-selection";

export type SupportedLanguage = LanguageCode;

export interface MainMenuSenderDeps {
  messagingClient: TwilioMessagingClient;
  fromNumber: string;
  contentSidByLanguage: Record<SupportedLanguage, string>;
}

export interface SendMainMenuInput {
  to: string;
  language: SupportedLanguage;
  /** Twilio MessageSid, used only for safe error correlation — never logged with content. */
  correlationId: string;
}

const PLAIN_TEXT_MENU: Record<SupportedLanguage, string> = {
  en: [
    "What would you like to do today?",
    "",
    "1. File or resume a case",
    "2. Check case status",
    "3. Change language",
    "4. Help",
    "5. My cases",
    "",
    "Reply with 1, 2, 3, 4, or 5.",
  ].join("\n"),
  ml: [
    "ഇന്ന് എന്താണ് ചെയ്യേണ്ടത്?",
    "",
    "1. കേസ് ഫയൽ ചെയ്യുക അല്ലെങ്കിൽ തുടരുക",
    "2. കേസ് സ്ഥിതി പരിശോധിക്കുക",
    "3. ഭാഷ മാറ്റുക",
    "4. സഹായം",
    "5. എന്റെ കേസുകൾ",
    "",
    "1, 2, 3, 4, അല്ലെങ്കിൽ 5 എന്ന് മറുപടി നൽകുക.",
  ].join("\n"),
};

/**
 * Sends the localized main-menu Content Template, falling back to the
 * numbered plain-text menu if that send fails. Never surfaces Twilio's
 * internal error to the advocate. Shared by the language workflow (menu
 * sent right after a confirmed selection) and the main-menu workflow (menu
 * redisplay, help, unknown input) so there is exactly one send path.
 */
export async function sendMainMenu(deps: MainMenuSenderDeps, input: SendMainMenuInput): Promise<boolean> {
  try {
    await deps.messagingClient.sendContentTemplate({
      from: deps.fromNumber,
      to: input.to,
      contentSid: deps.contentSidByLanguage[input.language],
    });
    return true;
  } catch {
    logWorkflowError({ code: "main_menu_content_send_failed", correlationId: input.correlationId });

    try {
      await deps.messagingClient.sendText({
        from: deps.fromNumber,
        to: input.to,
        body: PLAIN_TEXT_MENU[input.language],
      });
      return true;
    } catch {
      logWorkflowError({ code: "main_menu_fallback_send_failed", correlationId: input.correlationId });
      return false;
    }
  }
}
