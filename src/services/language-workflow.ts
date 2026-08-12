import { parseLanguageSelection, type LanguageCode, type SelectionInput } from "../domain/language-selection";
import type { MessagingClient } from "../types/messaging-client";
import type { ConversationRepository } from "../repositories/conversation-repository";
import { logWorkflowError } from "../lib/logger";
import { sendMainMenu, type SupportedLanguage } from "./main-menu-sender";

const PLAIN_TEXT_LANGUAGE_MENU = [
  "🙏 നമസ്കാരം | Welcome",
  "",
  "Please choose your preferred language:",
  "1. English",
  "2. മലയാളം",
].join("\n");

const INTERACTIVE_LANGUAGE_BODY = "🙏 നമസ്കാരം | Welcome\n\nPlease choose your preferred language:";
// Button titles, well within Meta's 20-character limit for both scripts.
const INTERACTIVE_LANGUAGE_BUTTONS = [
  { id: "language:en", title: "English" },
  { id: "language:ml", title: "മലയാളം" },
];

const CONFIRMATIONS: Record<LanguageCode, string> = {
  en: "✓ English selected.",
  ml: "✓ മലയാളം തിരഞ്ഞെടുത്തു.",
};

export interface LanguageWorkflowDeps {
  conversationRepo: ConversationRepository;
  messagingClient: MessagingClient;
  fromNumber: string;
  /** Content SID of the bilingual language-selection picker (#3). */
  contentSid: string;
  /** Content SIDs of the localized main menu (#5), sent right after a confirmed selection. */
  mainMenuContentSid: Record<SupportedLanguage, string>;
}

export interface LanguageWorkflowInput {
  /** Already normalized via normalizeWhatsappNumber. */
  whatsappNumber: string;
  /** Twilio MessageSid, used only for safe error correlation — never logged with content. */
  messageId: string;
  selection: SelectionInput;
}

export interface LanguageWorkflowResult {
  /** False when a required outbound send (and its fallback, where one exists) failed. */
  delivered: boolean;
}

/**
 * Sends the bilingual language picker, preferring a provider's native
 * interactive buttons when available (Kapso — #16 task 6), then the
 * Content Template (Twilio), then the numbered plain-text menu. Never
 * surfaces a provider's internal error to the advocate.
 */
async function sendLanguagePicker(deps: LanguageWorkflowDeps, input: LanguageWorkflowInput): Promise<boolean> {
  if (deps.messagingClient.sendInteractiveButtons) {
    try {
      await deps.messagingClient.sendInteractiveButtons({
        from: deps.fromNumber,
        to: input.whatsappNumber,
        bodyText: INTERACTIVE_LANGUAGE_BODY,
        buttons: INTERACTIVE_LANGUAGE_BUTTONS,
      });
      return true;
    } catch {
      logWorkflowError({ code: "language_picker_interactive_send_failed", correlationId: input.messageId });
      // Falls through to the Content Template / plain-text path below —
      // same graceful-degradation chain Twilio's Content Template failure
      // already falls into.
    }
  }

  try {
    await deps.messagingClient.sendContentTemplate({
      from: deps.fromNumber,
      to: input.whatsappNumber,
      contentSid: deps.contentSid,
    });
    return true;
  } catch {
    logWorkflowError({ code: "language_picker_content_send_failed", correlationId: input.messageId });

    try {
      await deps.messagingClient.sendText({
        from: deps.fromNumber,
        to: input.whatsappNumber,
        body: PLAIN_TEXT_LANGUAGE_MENU,
      });
      return true;
    } catch {
      logWorkflowError({ code: "language_picker_fallback_send_failed", correlationId: input.messageId });
      return false;
    }
  }
}

async function sendConfirmation(
  deps: LanguageWorkflowDeps,
  input: LanguageWorkflowInput,
  language: LanguageCode,
): Promise<boolean> {
  try {
    await deps.messagingClient.sendText({
      from: deps.fromNumber,
      to: input.whatsappNumber,
      body: CONFIRMATIONS[language],
    });
    return true;
  } catch {
    logWorkflowError({ code: "language_confirmation_send_failed", correlationId: input.messageId });
    return false;
  }
}

/**
 * Clears any selected language, moves the conversation back to
 * AWAITING_LANGUAGE, and resends the picker. The single reusable
 * "change language" action shared by #3's own "language"/"ഭാഷ" trigger and
 * #5's `menu:change-language` menu action — never a second implementation.
 */
export async function reopenLanguagePicker(
  deps: LanguageWorkflowDeps,
  input: { whatsappNumber: string; messageId: string },
): Promise<LanguageWorkflowResult> {
  const now = new Date();
  await deps.conversationRepo.resetToAwaitingLanguage(input.whatsappNumber, now);
  return {
    delivered: await sendLanguagePicker(deps, { whatsappNumber: input.whatsappNumber, messageId: input.messageId, selection: {} }),
  };
}

/**
 * Implements the Part C routing rules for a conversation that does not yet
 * have a confirmed language: opens the bilingual picker for a brand-new
 * advocate, and for one already AWAITING_LANGUAGE either persists a
 * recognized selection (sending the confirmation, then immediately the
 * localized main menu per #5) or re-sends the picker for anything
 * unrecognized. Once a conversation reaches MAIN_MENU (or beyond), routing
 * moves to `main-menu-workflow.ts` — this function is never called for
 * those states.
 */
export async function handleInboundForLanguageSelection(
  deps: LanguageWorkflowDeps,
  input: LanguageWorkflowInput,
): Promise<LanguageWorkflowResult> {
  const now = new Date();
  const conversation = await deps.conversationRepo.findByWhatsappNumber(input.whatsappNumber);

  if (!conversation) {
    // A completely new advocate always sees the picker first, even if their
    // first message happens to already look like a valid selection.
    await deps.conversationRepo.createAwaitingLanguage(input.whatsappNumber, now);
    return { delivered: await sendLanguagePicker(deps, input) };
  }

  const selected = parseLanguageSelection(input.selection);

  if (!selected) {
    await deps.conversationRepo.touchLastInboundAt(input.whatsappNumber, now);
    return { delivered: await sendLanguagePicker(deps, input) };
  }

  await deps.conversationRepo.setLanguageAndMainMenu(input.whatsappNumber, selected, now);
  const confirmationDelivered = await sendConfirmation(deps, input, selected);
  // Not part of the outbox — this initial menu send has no outbound_messages
  // row to reconcile a provider message id against, so only .delivered
  // matters here (unlike the nav:main-menu transitions in filing-workflow.ts).
  const { delivered: menuDelivered } = await sendMainMenu(
    { messagingClient: deps.messagingClient, fromNumber: deps.fromNumber, contentSidByLanguage: deps.mainMenuContentSid },
    { to: input.whatsappNumber, language: selected, correlationId: input.messageId },
  );
  return { delivered: confirmationDelivered && menuDelivered };
}
