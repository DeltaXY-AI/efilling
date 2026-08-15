import {
  handleInboundForLanguageSelection,
  reopenLanguagePicker,
  sendLanguagePicker,
  type LanguageWorkflowDeps,
  type LanguageWorkflowResult,
} from "./language-workflow";
import { isRestartRequest } from "../domain/restart";
import { handleInboundForMainMenu, type MainMenuWorkflowDeps } from "./main-menu-workflow";
import { handleDraftChoiceInput, handleFilingNoticeInput, type FilingWorkflowDeps } from "./filing-workflow";
import { handleEnrolmentConfirmInput, handleEnrolmentInput, type EnrolmentWorkflowDeps } from "./enrolment-workflow";
import {
  handleFilingDocChequeInput,
  handleFilingDocIdInput,
  handleFilingDocMemoInput,
  handleFilingDocNoticeInput,
  handleFilingDocSupportInput,
  type FilingDocumentWorkflowDeps,
} from "./filing-document-workflow";
import {
  handleComplainantAddressInput,
  handleComplainantConfirmInput,
  handleComplainantEditAddressInput,
  handleComplainantEditEmailInput,
  handleComplainantEditEnrolInput,
  handleComplainantEditFieldSelection,
  handleComplainantEditNameInput,
  handleComplainantEditPhoneInput,
  handleComplainantEditRoleInput,
  handleComplainantEmailInput,
  handleComplainantEnrolInput,
  handleComplainantNameInput,
  handleComplainantPhoneInput,
  handleComplainantRoleInput,
  type ComplainantWorkflowDeps,
} from "./complainant-workflow";
import {
  handleAccusedAddressInput,
  handleAccusedConfirmInput,
  handleAccusedEditAddressInput,
  handleAccusedEditEntityTypeInput,
  handleAccusedEditFieldSelection,
  handleAccusedEditNameInput,
  handleAccusedEditPhoneInput,
  handleAccusedEntityTypeInput,
  handleAccusedNameInput,
  handleAccusedPhoneInput,
  type AccusedWorkflowDeps,
} from "./accused-workflow";
import {
  handleFilingAmountInput,
  handleFilingBankBranchInput,
  handleFilingChequeDateInput,
  handleFilingChequeNumberInput,
  handleFilingMemoDateInput,
  handleFilingNoticeDateInput,
  handleFilingPartPaymentInput,
  handleFilingReturnReasonInput,
  handleFilingServiceDateInput,
  handleFilingStoryInput,
  handleFilingWitnessInput,
  type FilingDetailsWorkflowDeps,
} from "./filing-details-workflow";
import { handleFilingWrittenAccountInput } from "./filing-document-workflow";
import {
  handleFilingCourtInput,
  handleFilingDeclareInput,
  handleFilingEditAmountInput,
  handleFilingEditBankBranchInput,
  handleFilingEditChequeDateInput,
  handleFilingEditChequeFieldInput,
  handleFilingEditChequeNumberInput,
  handleFilingEditCourtInput,
  handleFilingEditGroupInput,
  handleFilingEditMemoDateInput,
  handleFilingEditNarrativeFieldInput,
  handleFilingEditNoticeDateInput,
  handleFilingEditPartPaymentInput,
  handleFilingEditReturnReasonInput,
  handleFilingEditServiceDateInput,
  handleFilingEditStoryInput,
  handleFilingEditWitnessInput,
  handleFilingReviewInput,
  type FilingReviewWorkflowDeps,
} from "./filing-review-workflow";
import { handleFilingDraftReadyInput, handleFilingOtpInput, type FilingSignWorkflowDeps } from "./filing-sign-workflow";
import type { ConversationRepository } from "../repositories/conversation-repository";
import { logWorkflowError } from "../lib/logger";
import type { InboundMedia } from "../types/inbound-message";

export interface InboundRouterDeps {
  conversationRepo: ConversationRepository;
  languageWorkflowDeps: LanguageWorkflowDeps;
  mainMenuSenderDeps: MainMenuWorkflowDeps["mainMenuSenderDeps"];
  filingWorkflowDeps: FilingWorkflowDeps;
  enrolmentWorkflowDeps: EnrolmentWorkflowDeps;
  filingDocumentWorkflowDeps: FilingDocumentWorkflowDeps;
  complainantWorkflowDeps: ComplainantWorkflowDeps;
  accusedWorkflowDeps: AccusedWorkflowDeps;
  filingDetailsWorkflowDeps: FilingDetailsWorkflowDeps;
  filingReviewWorkflowDeps: FilingReviewWorkflowDeps;
  filingSignWorkflowDeps: FilingSignWorkflowDeps;
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
  /** The actual media attachments — only #31's document-upload states consume these; every other state only reads mediaCount. Defaults to an empty array when omitted. */
  media?: InboundMedia[];
}

const RESTART_CONFIRMATION_MESSAGE = "🔄 Starting over — your previous session has been cleared.";

/**
 * Handles the "restart"/"start over" keyword. Unlike every other action in
 * this codebase, it is recognized from *any* state (checked before
 * per-state dispatch below), not gated behind the main menu — a user stuck
 * mid-enrolment or mid-complainant-details never sees that menu again, so
 * a menu-only "start over" button would not actually help them.
 *
 * Abandons any in-progress filing draft (so `active_filing_id` never keeps
 * pointing at an ABANDONED filing), then resets the conversation the same
 * way "change language" does: back to AWAITING_LANGUAGE with the language
 * picker resent.
 */
async function handleRestartRequest(
  deps: InboundRouterDeps,
  input: { whatsappNumber: string; messageId: string; conversationId: string },
): Promise<LanguageWorkflowResult> {
  await deps.filingWorkflowDeps.withTransaction(async (tx) => {
    const locked = await deps.conversationRepo.lockById(tx, input.conversationId);
    if (locked.activeFilingId) {
      await deps.filingWorkflowDeps.filingRepo.abandonDraft(tx, locked.activeFilingId);
    }
    await deps.conversationRepo.resetForRestartInTx(tx, input.conversationId);
  });

  let confirmationDelivered = true;
  try {
    await deps.languageWorkflowDeps.messagingClient.sendText({
      from: deps.languageWorkflowDeps.fromNumber,
      to: input.whatsappNumber,
      body: RESTART_CONFIRMATION_MESSAGE,
    });
  } catch {
    logWorkflowError({ code: "restart_confirmation_send_failed", correlationId: input.messageId });
    confirmationDelivered = false;
  }

  const pickerDelivered = await sendLanguagePicker(deps.languageWorkflowDeps, {
    whatsappNumber: input.whatsappNumber,
    messageId: input.messageId,
    selection: {},
  });

  return { delivered: confirmationDelivered && pickerDelivered };
}

/**
 * Persisted states this deployment recognizes but doesn't yet implement a
 * workflow for (FILING_START/CASE_STATUS_START are owned by later issues;
 * FILING_FILED_START is owned by Prototype parity Phase 7 (#35), the next
 * issue after this one — exactly the same placeholder role
 * DRAFT_READY_START played for #34; COMPLAINANT_DETAILS_START,
 * ACCUSED_DETAILS_START, CHEQUE_DETAILS_START, and (as of #34)
 * DRAFT_READY_START are all legacy-only, see schema.ts; NEW is the schema
 * column default, never actually persisted by app code). These intentionally keep the
 * conversation "alive" without sending anything, per "do not automatically
 * send the menu... while a future filing subflow is waiting for specific
 * input" — unlike a state outside this set, which this deployment has never
 * heard of at all (#26, added specifically after a real Sandbox
 * conversation got stuck at this exact CHEQUE_DETAILS_START value on a
 * deployment that didn't yet recognize it — never repeat that by leaving a
 * cascade target off this list).
 */
const KNOWN_UNIMPLEMENTED_STATES: ReadonlySet<string> = new Set([
  "NEW",
  "FILING_START",
  "CASE_STATUS_START",
  "COMPLAINANT_DETAILS_START",
  "ACCUSED_DETAILS_START",
  "CHEQUE_DETAILS_START",
  "DRAFT_READY_START",
  "FILING_FILED_START",
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
 * (#9), filing-document-workflow at every FILING_DOC_* step (#31),
 * complainant-workflow at every COMPLAINANT_* step (#10), accused-workflow
 * at every ACCUSED_* step (#11), filing-sign-workflow at
 * FILING_DRAFT_READY/FILING_OTP_PENDING (#34). Any other known-but-unimplemented state
 * (see KNOWN_UNIMPLEMENTED_STATES) keeps the conversation alive without
 * sending anything; any state outside even that set is recovered instead of
 * stranding the user silently (#26). Before any of that, an existing
 * conversation's "restart" keyword is checked first — it applies regardless
 * of state (see handleRestartRequest).
 */
export async function routeInboundMessage(deps: InboundRouterDeps, input: InboundRouterInput): Promise<LanguageWorkflowResult> {
  const conversation = await deps.conversationRepo.findByWhatsappNumber(input.whatsappNumber);

  // Checked ahead of per-state dispatch: a brand-new conversation has
  // nothing to restart, and one already AWAITING_LANGUAGE is already at the
  // destination a restart would send it to, so both are left to the normal
  // language-selection handling below (which safely no-ops/resends the
  // picker for unrecognized input, e.g. "restart" not being a language).
  if (
    conversation &&
    conversation.state !== "AWAITING_LANGUAGE" &&
    isRestartRequest({ buttonPayload: input.buttonPayload, buttonText: input.buttonText, body: input.body })
  ) {
    return handleRestartRequest(deps, {
      whatsappNumber: input.whatsappNumber,
      messageId: input.messageId,
      conversationId: conversation.id,
    });
  }

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

  // #31: the 5 document-upload groups, between enrolment confirmation and
  // complainant details.
  const documentEvent = {
    conversationId: conversation.id,
    whatsappNumber: input.whatsappNumber,
    messageId: input.messageId,
    language,
    text: input.body,
    buttonPayload: input.buttonPayload,
    buttonText: input.buttonText,
    media: input.media ?? [],
  };
  if (conversation.state === "FILING_DOC_CHEQUE") {
    return handleFilingDocChequeInput(deps.filingDocumentWorkflowDeps, documentEvent);
  }
  if (conversation.state === "FILING_DOC_MEMO") {
    return handleFilingDocMemoInput(deps.filingDocumentWorkflowDeps, documentEvent);
  }
  if (conversation.state === "FILING_DOC_NOTICE") {
    return handleFilingDocNoticeInput(deps.filingDocumentWorkflowDeps, documentEvent);
  }
  if (conversation.state === "FILING_DOC_ID") {
    return handleFilingDocIdInput(deps.filingDocumentWorkflowDeps, documentEvent);
  }
  if (conversation.state === "FILING_DOC_SUPPORT") {
    return handleFilingDocSupportInput(deps.filingDocumentWorkflowDeps, documentEvent);
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

  // #33 Part A: the two new leading Complainant-screen fields, before #10's existing ones below.
  if (conversation.state === "COMPLAINANT_ROLE_PENDING") {
    return handleComplainantRoleInput(deps.complainantWorkflowDeps, actionInput);
  }
  if (conversation.state === "COMPLAINANT_ENROL_PENDING") {
    return handleComplainantEnrolInput(deps.complainantWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "COMPLAINANT_EDIT_ROLE_PENDING") {
    return handleComplainantEditRoleInput(deps.complainantWorkflowDeps, actionInput);
  }
  if (conversation.state === "COMPLAINANT_EDIT_ENROL_PENDING") {
    return handleComplainantEditEnrolInput(deps.complainantWorkflowDeps, fieldEvent);
  }

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

  // #11: the accused-details flow (Parts A/G-K).
  if (conversation.state === "ACCUSED_NAME_PENDING") {
    return handleAccusedNameInput(deps.accusedWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "ACCUSED_PHONE_PENDING") {
    return handleAccusedPhoneInput(deps.accusedWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "ACCUSED_ADDRESS_PENDING") {
    return handleAccusedAddressInput(deps.accusedWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "ACCUSED_CONFIRM") {
    return handleAccusedConfirmInput(deps.accusedWorkflowDeps, actionInput);
  }
  if (conversation.state === "ACCUSED_EDIT_FIELD") {
    return handleAccusedEditFieldSelection(deps.accusedWorkflowDeps, actionInput);
  }
  if (conversation.state === "ACCUSED_EDIT_NAME_PENDING") {
    return handleAccusedEditNameInput(deps.accusedWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "ACCUSED_EDIT_PHONE_PENDING") {
    return handleAccusedEditPhoneInput(deps.accusedWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "ACCUSED_EDIT_ADDRESS_PENDING") {
    return handleAccusedEditAddressInput(deps.accusedWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "ACCUSED_ENTITY_TYPE_PENDING") {
    return handleAccusedEntityTypeInput(deps.accusedWorkflowDeps, actionInput);
  }
  if (conversation.state === "ACCUSED_EDIT_ENTITY_TYPE_PENDING") {
    return handleAccusedEditEntityTypeInput(deps.accusedWorkflowDeps, actionInput);
  }

  // #33 Part C: cheque and notice particulars.
  if (conversation.state === "FILING_CHEQUE_NUMBER_PENDING") {
    return handleFilingChequeNumberInput(deps.filingDetailsWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "FILING_CHEQUE_DATE_PENDING") {
    return handleFilingChequeDateInput(deps.filingDetailsWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "FILING_AMOUNT_PENDING") {
    return handleFilingAmountInput(deps.filingDetailsWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "FILING_BANK_BRANCH_PENDING") {
    return handleFilingBankBranchInput(deps.filingDetailsWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "FILING_RETURN_REASON_PENDING") {
    return handleFilingReturnReasonInput(deps.filingDetailsWorkflowDeps, actionInput);
  }
  if (conversation.state === "FILING_MEMO_DATE_PENDING") {
    return handleFilingMemoDateInput(deps.filingDetailsWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "FILING_NOTICE_DATE_PENDING") {
    return handleFilingNoticeDateInput(deps.filingDetailsWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "FILING_SERVICE_DATE_PENDING") {
    return handleFilingServiceDateInput(deps.filingDetailsWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "FILING_PART_PAYMENT_PENDING") {
    return handleFilingPartPaymentInput(deps.filingDetailsWorkflowDeps, actionInput);
  }

  // #33 Part D: the narrative.
  if (conversation.state === "FILING_STORY_PENDING") {
    return handleFilingStoryInput(deps.filingDetailsWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "FILING_WITNESS_PENDING") {
    return handleFilingWitnessInput(deps.filingDetailsWorkflowDeps, actionInput);
  }

  // #33 Part E: the optional written-account upload — media-consuming, like #31's 5 document groups.
  if (conversation.state === "FILING_WRITTEN_ACCOUNT_PENDING") {
    return handleFilingWrittenAccountInput(deps.filingDocumentWorkflowDeps, documentEvent);
  }

  // #33 Part F: court, the combined review, and the declaration.
  if (conversation.state === "FILING_COURT_PENDING") {
    return handleFilingCourtInput(deps.filingReviewWorkflowDeps, actionInput);
  }
  if (conversation.state === "FILING_REVIEW") {
    return handleFilingReviewInput(deps.filingReviewWorkflowDeps, actionInput);
  }
  if (conversation.state === "FILING_EDIT_GROUP_PENDING") {
    return handleFilingEditGroupInput(deps.filingReviewWorkflowDeps, actionInput);
  }
  if (conversation.state === "FILING_EDIT_CHEQUE_FIELD_PENDING") {
    return handleFilingEditChequeFieldInput(deps.filingReviewWorkflowDeps, actionInput);
  }
  if (conversation.state === "FILING_EDIT_NARRATIVE_FIELD_PENDING") {
    return handleFilingEditNarrativeFieldInput(deps.filingReviewWorkflowDeps, actionInput);
  }
  if (conversation.state === "FILING_EDIT_CHEQUE_NUMBER_PENDING") {
    return handleFilingEditChequeNumberInput(deps.filingReviewWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "FILING_EDIT_CHEQUE_DATE_PENDING") {
    return handleFilingEditChequeDateInput(deps.filingReviewWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "FILING_EDIT_AMOUNT_PENDING") {
    return handleFilingEditAmountInput(deps.filingReviewWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "FILING_EDIT_BANK_BRANCH_PENDING") {
    return handleFilingEditBankBranchInput(deps.filingReviewWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "FILING_EDIT_RETURN_REASON_PENDING") {
    return handleFilingEditReturnReasonInput(deps.filingReviewWorkflowDeps, actionInput);
  }
  if (conversation.state === "FILING_EDIT_MEMO_DATE_PENDING") {
    return handleFilingEditMemoDateInput(deps.filingReviewWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "FILING_EDIT_NOTICE_DATE_PENDING") {
    return handleFilingEditNoticeDateInput(deps.filingReviewWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "FILING_EDIT_SERVICE_DATE_PENDING") {
    return handleFilingEditServiceDateInput(deps.filingReviewWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "FILING_EDIT_PART_PAYMENT_PENDING") {
    return handleFilingEditPartPaymentInput(deps.filingReviewWorkflowDeps, actionInput);
  }
  if (conversation.state === "FILING_EDIT_STORY_PENDING") {
    return handleFilingEditStoryInput(deps.filingReviewWorkflowDeps, fieldEvent);
  }
  if (conversation.state === "FILING_EDIT_WITNESS_PENDING") {
    return handleFilingEditWitnessInput(deps.filingReviewWorkflowDeps, actionInput);
  }
  if (conversation.state === "FILING_EDIT_COURT_PENDING") {
    return handleFilingEditCourtInput(deps.filingReviewWorkflowDeps, actionInput);
  }
  if (conversation.state === "FILING_DECLARE_PENDING") {
    return handleFilingDeclareInput(deps.filingReviewWorkflowDeps, actionInput);
  }

  // #34 (Prototype parity - Phase 6): draft-ready summary and simulated e-Sign.
  if (conversation.state === "FILING_DRAFT_READY") {
    return handleFilingDraftReadyInput(deps.filingSignWorkflowDeps, actionInput);
  }
  if (conversation.state === "FILING_OTP_PENDING") {
    return handleFilingOtpInput(deps.filingSignWorkflowDeps, fieldEvent);
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
