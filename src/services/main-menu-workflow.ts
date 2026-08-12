import { MENU_ACTION_TARGET_STATE, isMenuRedisplayRequest, parseMenuAction, type MenuSelectionInput } from "../domain/main-menu";
import { sendMainMenu, type MainMenuSenderDeps, type SupportedLanguage } from "./main-menu-sender";
import { reopenLanguagePicker, type LanguageWorkflowDeps, type LanguageWorkflowResult } from "./language-workflow";
import { handleFileOrResume, type FilingWorkflowDeps } from "./filing-workflow";
import type { ConversationRepository } from "../repositories/conversation-repository";
import { logWorkflowError } from "../lib/logger";

export interface MainMenuWorkflowDeps {
  conversationRepo: ConversationRepository;
  mainMenuSenderDeps: MainMenuSenderDeps;
  /** Reused as-is for the change-language action — never a second picker implementation. */
  languageWorkflowDeps: LanguageWorkflowDeps;
  /** Reused as-is for menu:file-case (#8) — never a second implementation of the draft/notice flow. */
  filingWorkflowDeps: FilingWorkflowDeps;
}

export interface MainMenuWorkflowInput {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  /** The conversation's persisted language — always set once state is MAIN_MENU. */
  language: SupportedLanguage;
  selection: MenuSelectionInput;
}

const HELP_TEXT: Record<SupportedLanguage, string> = {
  en: "This WhatsApp service helps a Complainant Advocate file and follow a cheque case. Choose an option from the main menu to continue.",
  ml: "പരാതിക്കാരന്റെ അഭിഭാഷകന് ചെക്ക് കേസ് ഫയൽ ചെയ്യാനും പിന്തുടരാനും ഈ WhatsApp സേവനം സഹായിക്കുന്നു. തുടരാൻ പ്രധാന മെനുവിൽ നിന്ന് ഒരു ഓപ്ഷൻ തിരഞ്ഞെടുക്കുക.",
};

const CLARIFICATION_TEXT: Record<SupportedLanguage, string> = {
  en: "Sorry, I didn't understand that. Please choose an option below.",
  ml: "ക്ഷമിക്കണം, മനസ്സിലായില്ല. ചുവടെയുള്ള ഒരു ഓപ്ഷൻ തിരഞ്ഞെടുക്കുക.",
};

const CASE_STATUS_ACKNOWLEDGEMENT: Record<SupportedLanguage, string> = {
  en: "Let's check your case status.",
  ml: "നിങ്ങളുടെ കേസ് സ്ഥിതി പരിശോധിക്കാം.",
};

async function sendPlainText(deps: MainMenuWorkflowDeps, input: MainMenuWorkflowInput, body: string, code: string): Promise<boolean> {
  try {
    await deps.mainMenuSenderDeps.messagingClient.sendText({ from: deps.mainMenuSenderDeps.fromNumber, to: input.whatsappNumber, body });
    return true;
  } catch {
    logWorkflowError({ code, correlationId: input.messageId });
    return false;
  }
}

// Menu redisplay/help/clarification are not part of the outbox — there's no
// outbound_messages row to reconcile a provider message id against here, so
// this unwraps SendOutcome to the plain boolean every caller in this file
// already expects (unlike the nav:main-menu transitions in filing-workflow.ts).
async function redisplayMenu(deps: MainMenuWorkflowDeps, input: MainMenuWorkflowInput): Promise<boolean> {
  const { delivered } = await sendMainMenu(deps.mainMenuSenderDeps, {
    to: input.whatsappNumber,
    language: input.language,
    correlationId: input.messageId,
  });
  return delivered;
}

/**
 * Implements Parts B–D's MAIN_MENU routing table: menu redisplay on
 * "menu"/"മെനു", the four stable menu actions (file-case/case-status ->
 * their *_START states, change-language -> reused #3 picker, help -> stays
 * MAIN_MENU and redisplays), and a safe redisplay-with-clarification for
 * anything unrecognized. Only ever called while the conversation is in
 * MAIN_MENU — routing for other states lives in language-workflow.ts or is
 * out of scope for this slice.
 */
export async function handleInboundForMainMenu(
  deps: MainMenuWorkflowDeps,
  input: MainMenuWorkflowInput,
): Promise<LanguageWorkflowResult> {
  const now = new Date();

  if (isMenuRedisplayRequest(input.selection)) {
    await deps.conversationRepo.touchLastInboundAt(input.whatsappNumber, now);
    return { delivered: await redisplayMenu(deps, input) };
  }

  const action = parseMenuAction(input.selection);

  if (!action) {
    await deps.conversationRepo.touchLastInboundAt(input.whatsappNumber, now);
    const clarified = await sendPlainText(deps, input, CLARIFICATION_TEXT[input.language], "main_menu_clarification_send_failed");
    const menuDelivered = await redisplayMenu(deps, input);
    return { delivered: clarified && menuDelivered };
  }

  if (action === "menu:change-language") {
    return reopenLanguagePicker(deps.languageWorkflowDeps, { whatsappNumber: input.whatsappNumber, messageId: input.messageId });
  }

  if (action === "menu:help") {
    await deps.conversationRepo.touchLastInboundAt(input.whatsappNumber, now);
    const helpSent = await sendPlainText(deps, input, HELP_TEXT[input.language], "main_menu_help_send_failed");
    const menuDelivered = await redisplayMenu(deps, input);
    return { delivered: helpSent && menuDelivered };
  }

  if (action === "menu:file-case") {
    // #8 owns everything past this point: active-draft check, draft-choice
    // vs. test-notice routing, and draft creation — never reimplemented here.
    return handleFileOrResume(deps.filingWorkflowDeps, {
      conversationId: input.conversationId,
      whatsappNumber: input.whatsappNumber,
      messageId: input.messageId,
      language: input.language,
    });
  }

  // menu:case-status — case-status lookup itself remains out of scope; this
  // slice only owns the initial transition + acknowledgement.
  const targetState = MENU_ACTION_TARGET_STATE[action];
  await deps.conversationRepo.setState(input.whatsappNumber, targetState, now);
  const delivered = await sendPlainText(deps, input, CASE_STATUS_ACKNOWLEDGEMENT[input.language], "main_menu_acknowledgement_send_failed");
  return { delivered };
}
