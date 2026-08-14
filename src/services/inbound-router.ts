import {
  handleInboundForLanguageSelection,
  reopenLanguagePicker,
  type LanguageWorkflowDeps,
  type LanguageWorkflowResult,
} from "./language-workflow";
import { handleInboundForMainMenu, type MainMenuWorkflowDeps } from "./main-menu-workflow";
import { handleDraftChoiceInput, handleFilingNoticeInput, type FilingWorkflowDeps } from "./filing-workflow";
import { handleEnrolmentConfirmInput, handleEnrolmentInput, type EnrolmentWorkflowDeps } from "./enrolment-workflow";
import {
  handleComplainantAddressInput,
  handleComplainantConfirmInput,
  handleComplainantEditAddressInput,
  handleComplainantEditEmailInput,
  handleComplainantEditFieldSelection,
  handleComplainantEditNameInput,
  handleComplainantEditPhoneInput,
  handleComplainantEmailInput,
  handleComplainantNameInput,
  handleComplainantPhoneInput,
  type ComplainantWorkflowDeps,
} from "./complainant-workflow";
import type { ConversationRepository } from "../repositories/conversation-repository";
import { logWorkflowError } from "../lib/logger";

export interface InboundRouterDeps {
  conversationRepo: ConversationRepository;
  languageWorkflowDeps: LanguageWorkflowDeps;
  mainMenuSenderDeps: MainMenuWorkflowDeps["mainMenuSenderDeps"];
  filingWorkflowDeps: FilingWorkflowDeps;
  enrolmentWorkflowDeps: EnrolmentWorkflowDeps;
  complainantWorkflowDeps: ComplainantWorkflowDeps;
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
 * Persisted states this deployment recognizes but doesn't yet implement a
 * workflow for (FILING_START/CASE_STATUS_START/ACCUSED_DETAILS_START are
 * owned by later issues; COMPLAINANT_DETAILS_START is legacy-only, see
 * schema.ts; NEW is the schema column default, never actually persisted by
 * app code). These intentionally keep the conversation "alive" without
 * sending anything, per "do not automatically send the menu... while a
 * future filing subflow is waiting for specific input" — unlike a state
 * outside this set, which this deployment has never heard of at all (#26).
 */
const KNOWN_UNIMPLEMENTED_STATES: ReadonlySet<string> = new Set([
  "NEW",
  "FILING_START",
  "CASE_STATUS_START",
  "COMPLAINANT_DETAILS_START",
  "ACCUSED_DETAILS_START",
]);

const UNSUPPORTED_STATE_RECOVERY_MESSAGE =
  "Your previous flow is no longer available. Please choose an option to continue.";

/**
 * #26: recovers a conversation persisted in a state this deployment doesn't
 * recognize at all — e.g. left behind by a different/newer deployment's
 * migration — instead of silently doing nothing (a real incident: a
 * Sandbox sender got stuck in CHEQUE_DETAILS_START, which isn't in this
 * branch's ConversationState union). Sends a plain-text explanation, then
 * resets the conversation to AWAITING_LANGUAGE and resends the language
 * picker, the same supported entry point every brand-new conversation
 * starts at.
 */
async function recoverFromUnsupportedState(
  deps: InboundRouterDeps,
  input: { whatsappNumber: string; messageId: string; state: string },
): Promise<LanguageWorkflowResult> {
  // Safe to log: a state name is not user data or message content, and no
  // phone number is included — messageId alone correlates with Twilio's logs.
  logWorkflowError({ code: "unsupported_conversation_state", correlationId: input.messageId, state: input.state });

  let recoveryTextDelivered = true;
  try {
    await deps.languageWorkflowDeps.messagingClient.sendText({
      from: deps.languageWorkflowDeps.fromNumber,
      to: input.whatsappNumber,
      body: UNSUPPORTED_STATE_RECOVERY_MESSAGE,
    });
  } catch {
    logWorkflowError({ code: "unsupported_state_recovery_send_failed", correlationId: input.messageId });
    recoveryTextDelivered = false;
  }

  const pickerResult = await reopenLanguagePicker(deps.languageWorkflowDeps, {
    whatsappNumber: input.whatsappNumber,
    messageId: input.messageId,
  });

  return { delivered: recoveryTextDelivered && pickerResult.delivered };
}

/**
 * Dispatches an inbound message to the workflow that owns the
 * conversation's current state: language-workflow for a brand-new
 * conversation or one still AWAITING_LANGUAGE, main-menu-workflow at
 * MAIN_MENU, filing-workflow at FILING_DRAFT_CHOICE/FILING_NOTICE (#8),
 * enrolment-workflow at ADVOCATE_ENROLMENT_PENDING/ADVOCATE_ENROLMENT_CONFIRM
 * (#9), complainant-workflow at every COMPLAINANT_* step (#10). Any other
 * known-but-unimplemented state (see KNOWN_UNIMPLEMENTED_STATES) keeps the
 * conversation alive without sending anything; any state outside even that
 * set is recovered instead of stranding the user silently (#26).
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

  const fieldEvent = {
    conversationId: conversation.id,
    whatsappNumber: input.whatsappNumber,
    messageId: input.messageId,
    language,
    text: input.body,
    mediaCount: input.mediaCount ?? 0,
  };
  const actionInput = { conversationId: conversation.id, whatsappNumber: input.whatsappNumber, messageId: input.messageId, language, selection };

  // #10: the complainant-details flow (Parts A/G-L).
  if (conversation.state === "COMPLAINANT_NAME_PENDING") {
    return handleComplainantNameInput(deps.complainantWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "COMPLAINANT_PHONE_PENDING") {
    return handleComplainantPhoneInput(deps.complainantWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "COMPLAINANT_EMAIL_PENDING") {
    return handleComplainantEmailInput(deps.complainantWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "COMPLAINANT_ADDRESS_PENDING") {
    return handleComplainantAddressInput(deps.complainantWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "COMPLAINANT_CONFIRM") {
    return handleComplainantConfirmInput(deps.complainantWorkflowDeps, actionInput);
  }
  if (conversation.state === "COMPLAINANT_EDIT_FIELD") {
    return handleComplainantEditFieldSelection(deps.complainantWorkflowDeps, actionInput);
  }
  if (conversation.state === "COMPLAINANT_EDIT_NAME_PENDING") {
    return handleComplainantEditNameInput(deps.complainantWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "COMPLAINANT_EDIT_PHONE_PENDING") {
    return handleComplainantEditPhoneInput(deps.complainantWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "COMPLAINANT_EDIT_EMAIL_PENDING") {
    return handleComplainantEditEmailInput(deps.complainantWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "COMPLAINANT_EDIT_ADDRESS_PENDING") {
    return handleComplainantEditAddressInput(deps.complainantWorkflowDeps, fieldEvent);
  }

  if (KNOWN_UNIMPLEMENTED_STATES.has(conversation.state)) {
    await deps.conversationRepo.touchLastInboundAt(input.whatsappNumber, new Date());
    return { delivered: true };
  }

  // A persisted state this deployment has never heard of (#26) — recover
  // instead of silently doing nothing.
  return recoverFromUnsupportedState(deps, {
    whatsappNumber: input.whatsappNumber,
    messageId: input.messageId,
    state: conversation.state,
  });
}
