import { handleInboundForLanguageSelection, type LanguageWorkflowDeps, type LanguageWorkflowResult } from "./language-workflow";
import { handleInboundForMainMenu, type MainMenuWorkflowDeps } from "./main-menu-workflow";
import type { ConversationRepository } from "../repositories/conversation-repository";

export interface InboundRouterDeps {
  conversationRepo: ConversationRepository;
  languageWorkflowDeps: LanguageWorkflowDeps;
  mainMenuSenderDeps: MainMenuWorkflowDeps["mainMenuSenderDeps"];
}

export interface InboundRouterInput {
  whatsappNumber: string;
  messageId: string;
  buttonPayload?: string;
  buttonText?: string;
  listId?: string;
  listTitle?: string;
  body: string;
}

/**
 * Dispatches an inbound message to the workflow that owns the
 * conversation's current state: language-workflow for a brand-new
 * conversation or one still AWAITING_LANGUAGE, main-menu-workflow once
 * language is confirmed and the conversation is at MAIN_MENU. States beyond
 * that (FILING_START/CASE_STATUS_START) are out of scope for #5 — later
 * issues own their own routing; for now this only keeps the conversation
 * "alive" without sending anything, per "do not automatically send the
 * menu... while a future filing subflow is waiting for specific input".
 */
export async function routeInboundMessage(deps: InboundRouterDeps, input: InboundRouterInput): Promise<LanguageWorkflowResult> {
  const conversation = await deps.conversationRepo.findByWhatsappNumber(input.whatsappNumber);

  if (!conversation || conversation.state === "AWAITING_LANGUAGE") {
    return handleInboundForLanguageSelection(deps.languageWorkflowDeps, {
      whatsappNumber: input.whatsappNumber,
      messageId: input.messageId,
      selection: { buttonPayload: input.buttonPayload, buttonText: input.buttonText, body: input.body },
    });
  }

  if (conversation.state === "MAIN_MENU") {
    // language is always set once a conversation reaches MAIN_MENU —
    // setLanguageAndMainMenu persists both together.
    const language = conversation.language ?? "en";
    return handleInboundForMainMenu(
      {
        conversationRepo: deps.conversationRepo,
        mainMenuSenderDeps: deps.mainMenuSenderDeps,
        languageWorkflowDeps: deps.languageWorkflowDeps,
      },
      {
        whatsappNumber: input.whatsappNumber,
        messageId: input.messageId,
        language,
        selection: {
          buttonPayload: input.buttonPayload,
          buttonText: input.buttonText,
          listId: input.listId,
          listTitle: input.listTitle,
          body: input.body,
        },
      },
    );
  }

  // FILING_START / CASE_STATUS_START — owned by later issues.
  await deps.conversationRepo.touchLastInboundAt(input.whatsappNumber, new Date());
  return { delivered: true };
}
