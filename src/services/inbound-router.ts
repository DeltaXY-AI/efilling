import { handleInboundForLanguageSelection, type LanguageWorkflowDeps, type LanguageWorkflowResult } from "./language-workflow";
import { handleInboundForMainMenu, type MainMenuWorkflowDeps } from "./main-menu-workflow";
import { handleDraftChoiceInput, handleFilingNoticeInput, type FilingWorkflowDeps } from "./filing-workflow";
import { handleEnrolmentConfirmInput, handleEnrolmentInput, type EnrolmentWorkflowDeps } from "./enrolment-workflow";
import type { ConversationRepository } from "../repositories/conversation-repository";

export interface InboundRouterDeps {
  conversationRepo: ConversationRepository;
  languageWorkflowDeps: LanguageWorkflowDeps;
  mainMenuSenderDeps: MainMenuWorkflowDeps["mainMenuSenderDeps"];
  filingWorkflowDeps: FilingWorkflowDeps;
  enrolmentWorkflowDeps: EnrolmentWorkflowDeps;
}

export interface InboundRouterInput {
  whatsappNumber: string;
  messageId: string;
  buttonPayload?: string;
  buttonText?: string;
  listId?: string;
  listTitle?: string;
  body: string;
  /** Number of media attachments on the inbound message — media-only enrolment input is rejected the same as any other invalid input (#9 Part F). Defaults to 0 when omitted (states that never read it). */
  mediaCount?: number;
}

/**
 * Dispatches an inbound message to the workflow that owns the
 * conversation's current state: language-workflow for a brand-new
 * conversation or one still AWAITING_LANGUAGE, main-menu-workflow at
 * MAIN_MENU, filing-workflow at FILING_DRAFT_CHOICE/FILING_NOTICE (#8),
 * enrolment-workflow at ADVOCATE_ENROLMENT_PENDING/ADVOCATE_ENROLMENT_CONFIRM
 * (#9). States beyond that (FILING_START/CASE_STATUS_START/
 * COMPLAINANT_DETAILS_START) are owned by later issues; for now this only
 * keeps the conversation "alive" without sending anything, per "do not
 * automatically send the menu... while a future filing subflow is waiting
 * for specific input".
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

  // language is always set once a conversation reaches MAIN_MENU (or
  // beyond) — setLanguageAndMainMenu persists both together.
  const language = conversation.language ?? "en";
  const selection = {
    buttonPayload: input.buttonPayload,
    buttonText: input.buttonText,
    listId: input.listId,
    listTitle: input.listTitle,
    body: input.body,
  };

  if (conversation.state === "MAIN_MENU") {
    return handleInboundForMainMenu(
      {
        conversationRepo: deps.conversationRepo,
        mainMenuSenderDeps: deps.mainMenuSenderDeps,
        languageWorkflowDeps: deps.languageWorkflowDeps,
        filingWorkflowDeps: deps.filingWorkflowDeps,
      },
      { conversationId: conversation.id, whatsappNumber: input.whatsappNumber, messageId: input.messageId, language, selection },
    );
  }

  if (conversation.state === "FILING_DRAFT_CHOICE") {
    return handleDraftChoiceInput(deps.filingWorkflowDeps, {
      conversationId: conversation.id,
      whatsappNumber: input.whatsappNumber,
      messageId: input.messageId,
      language,
      selection,
    });
  }

  if (conversation.state === "FILING_NOTICE") {
    return handleFilingNoticeInput(deps.filingWorkflowDeps, {
      conversationId: conversation.id,
      whatsappNumber: input.whatsappNumber,
      messageId: input.messageId,
      language,
      selection,
    });
  }

  if (conversation.state === "ADVOCATE_ENROLMENT_PENDING") {
    return handleEnrolmentInput(deps.enrolmentWorkflowDeps, {
      conversationId: conversation.id,
      whatsappNumber: input.whatsappNumber,
      messageId: input.messageId,
      language,
      text: input.body,
      mediaCount: input.mediaCount ?? 0,
    });
  }

  if (conversation.state === "ADVOCATE_ENROLMENT_CONFIRM") {
    return handleEnrolmentConfirmInput(deps.enrolmentWorkflowDeps, {
      conversationId: conversation.id,
      whatsappNumber: input.whatsappNumber,
      messageId: input.messageId,
      language,
      selection,
    });
  }

  // FILING_START / CASE_STATUS_START / COMPLAINANT_DETAILS_START — owned by later issues.
  await deps.conversationRepo.touchLastInboundAt(input.whatsappNumber, new Date());
  return { delivered: true };
}
