import type { MessagingClient, SendOutcome } from "../types/messaging-client";
import { logWorkflowError } from "../lib/logger";
import type { LanguageCode } from "../domain/language-selection";

export type SupportedLanguage = LanguageCode;

export interface MainMenuSenderDeps {
  messagingClient: MessagingClient;
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
    "",
    "Reply with 1, 2, 3, or 4.",
  ].join("\n"),
  ml: [
    "ഇന്ന് എന്താണ് ചെയ്യേണ്ടത്?",
    "",
    "1. കേസ് ഫയൽ ചെയ്യുക അല്ലെങ്കിൽ തുടരുക",
    "2. കേസ് സ്ഥിതി പരിശോധിക്കുക",
    "3. ഭാഷ മാറ്റുക",
    "4. സഹായം",
    "",
    "1, 2, 3, അല്ലെങ്കിൽ 4 എന്ന് മറുപടി നൽകുക.",
  ].join("\n"),
};

const INTERACTIVE_MENU_BODY: Record<SupportedLanguage, string> = {
  en: "What would you like to do today?",
  ml: "ഇന്ന് എന്താണ് ചെയ്യേണ്ടത്?",
};

const INTERACTIVE_MENU_BUTTON_TEXT: Record<SupportedLanguage, string> = {
  en: "Choose an option",
  ml: "ഓപ്ഷൻ തിരഞ്ഞെടുക്കുക",
};

// Row titles must stay within Meta's 24-character list-row-title limit.
// The English titles fit as-is. The Malayalam titles are NOT the
// PLAIN_TEXT_MENU sentences (those run well past 24 characters with their
// connecting words) — they reuse the shorter phrases already established
// as this action's recognized text-fallback in domain/main-menu.ts's
// TEXT_TO_ACTION map, rather than a new translation invented here. Still
// worth a native-speaker content review before use outside the spike. If
// Meta rejects a title's length anyway, the send throws and the existing
// Content Template / plain-text fallback below takes over — a degraded-UX
// risk, not a correctness one.
const INTERACTIVE_MENU_ROWS: Record<SupportedLanguage, { id: string; title: string }[]> = {
  en: [
    { id: "menu:file-case", title: "File or resume case" },
    { id: "menu:case-status", title: "Check case status" },
    { id: "menu:change-language", title: "Change language" },
    { id: "menu:help", title: "Help" },
  ],
  ml: [
    { id: "menu:file-case", title: "കേസ് ഫയൽ ചെയ്യുക" },
    { id: "menu:case-status", title: "കേസ് സ്ഥിതി" },
    { id: "menu:change-language", title: "ഭാഷ മാറ്റുക" },
    { id: "menu:help", title: "സഹായം" },
  ],
};

/**
 * Sends the localized main menu, preferring a provider's native
 * interactive list when available (Kapso — #16 task 6), then the Content
 * Template (Twilio), then the numbered plain-text menu. Never surfaces a
 * provider's internal error to the advocate. Shared by the language
 * workflow (menu sent right after a confirmed selection) and the main-menu
 * workflow (menu redisplay, help, unknown input) so there is exactly one
 * send path.
 */
export async function sendMainMenu(deps: MainMenuSenderDeps, input: SendMainMenuInput): Promise<SendOutcome> {
  if (deps.messagingClient.sendInteractiveList) {
    try {
      const result = await deps.messagingClient.sendInteractiveList({
        from: deps.fromNumber,
        to: input.to,
        bodyText: INTERACTIVE_MENU_BODY[input.language],
        buttonText: INTERACTIVE_MENU_BUTTON_TEXT[input.language],
        sections: [{ rows: INTERACTIVE_MENU_ROWS[input.language] }],
      });
      return { delivered: true, providerMessageId: result.providerMessageId };
    } catch {
      logWorkflowError({ code: "main_menu_interactive_send_failed", correlationId: input.correlationId });
      // Falls through to the Content Template / plain-text path below.
    }
  }

  try {
    const result = await deps.messagingClient.sendContentTemplate({
      from: deps.fromNumber,
      to: input.to,
      contentSid: deps.contentSidByLanguage[input.language],
    });
    return { delivered: true, providerMessageId: result.providerMessageId };
  } catch {
    logWorkflowError({ code: "main_menu_content_send_failed", correlationId: input.correlationId });

    try {
      const result = await deps.messagingClient.sendText({
        from: deps.fromNumber,
        to: input.to,
        body: PLAIN_TEXT_MENU[input.language],
      });
      return { delivered: true, providerMessageId: result.providerMessageId };
    } catch {
      logWorkflowError({ code: "main_menu_fallback_send_failed", correlationId: input.correlationId });
      return { delivered: false };
    }
  }
}
