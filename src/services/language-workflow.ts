import { isLanguageChangeRequest, parseLanguageSelection, type LanguageCode, type SelectionInput } from "../domain/language-selection";
import type { TwilioMessagingClient } from "../adapters/twilio/messaging-client";
import type { ConversationRepository } from "../repositories/conversation-repository";
import { logWorkflowError } from "../lib/logger";

const PLAIN_TEXT_LANGUAGE_MENU = [
  "🙏 നമസ്കാരം | Welcome",
  "",
  "Please choose your preferred language:",
  "1. English",
  "2. മലയാളം",
].join("\n");

const CONFIRMATIONS: Record<LanguageCode, string> = {
  en: "✓ English selected.",
  ml: "✓ മലയാളം തിരഞ്ഞെടുത്തു.",
};

export interface LanguageWorkflowDeps {
  conversationRepo: ConversationRepository;
  messagingClient: TwilioMessagingClient;
  fromNumber: string;
  contentSid: string;
}

export interface LanguageWorkflowInput {
  /** Already normalized via normalizeWhatsappNumber. */
  whatsappNumber: string;
  /** Twilio MessageSid, used only for safe error correlation — never logged with content. */
  messageId: string;
  selection: SelectionInput;
}

export interface LanguageWorkflowResult {
  /** False when both the Content Template send and its plain-text fallback failed. */
  delivered: boolean;
}

/**
 * Sends the bilingual language picker via the Content Template, falling
 * back to the numbered plain-text menu if that send fails. Never surfaces
 * Twilio's internal error to the advocate.
 */
async function sendLanguagePicker(deps: LanguageWorkflowDeps, input: LanguageWorkflowInput): Promise<boolean> {
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
 * Implements the Part C routing rules: opens the bilingual language picker
 * for new/awaiting-language advocates, persists a recognized selection and
 * moves to MAIN_MENU, and reopens the picker on an explicit language-change
 * request. MAIN_MENU routing beyond that is out of scope for this slice.
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

  if (conversation.state === "MAIN_MENU") {
    if (isLanguageChangeRequest(input.selection)) {
      await deps.conversationRepo.resetToAwaitingLanguage(input.whatsappNumber, now);
      return { delivered: await sendLanguagePicker(deps, input) };
    }

    await deps.conversationRepo.touchLastInboundAt(input.whatsappNumber, now);
    return { delivered: true };
  }

  // AWAITING_LANGUAGE
  const selected = parseLanguageSelection(input.selection);

  if (!selected) {
    await deps.conversationRepo.touchLastInboundAt(input.whatsappNumber, now);
    return { delivered: await sendLanguagePicker(deps, input) };
  }

  await deps.conversationRepo.setLanguageAndMainMenu(input.whatsappNumber, selected, now);
  return { delivered: await sendConfirmation(deps, input, selected) };
}
