import {
  isSkipSelection,
  parseCourtSelection,
  parseFilingChequeEditFieldSelection,
  parseFilingDeclareAction,
  parseFilingEditGroupSelection,
  parseFilingNarrativeEditFieldSelection,
  parseFilingReviewAction,
  parsePartPaymentSelection,
  parseReturnReasonSelection,
  parseWitnessSelection,
  type FilingChequeEditField,
  type FilingDetailSelectionInput,
  type FilingNarrativeEditField,
} from "../domain/filing-details";
import type { ConversationRepository, ConversationState } from "../repositories/conversation-repository";
import type { FilingDocumentRepository } from "../repositories/filing-document-repository";
import type { FilingPartyRecord, FilingPartyRepository } from "../repositories/filing-party-repository";
import type { FilingRecord, FilingRepository } from "../repositories/filing-repository";
import type { OutboundMessageRepository, OutboundMessageType } from "../repositories/outbound-message-repository";
import type { RepositoryTransaction } from "../repositories/transaction";
import {
  ERROR_TEXT as FILING_DETAILS_ERROR_TEXT,
  PROMPT_TEXT as FILING_DETAILS_PROMPT_TEXT,
  validateField as validateFilingDetailsTextField,
  type TextFieldKey,
} from "./filing-details-workflow";
import {
  sendCourtPrompt,
  sendFilingDeclarePrompt,
  sendFilingEditChequeFieldPrompt,
  sendFilingEditGroupPrompt,
  sendFilingEditNarrativeFieldPrompt,
  sendFilingReviewActions,
  sendFilingReviewSummary,
  sendPartPaymentPrompt,
  sendReturnReasonPrompt,
  sendWitnessPrompt,
  type FilingDetailsSenderDeps,
  type SendFilingDetailsMessageInput,
} from "./filing-details-sender";
import { sendDraftReadyActions, sendDraftReadySummary, type FilingSignSenderDeps } from "./filing-sign-sender";
import { sendFilingPlainText } from "./filing-sender";
import { sendMainMenu, type MainMenuSenderDeps, type SupportedLanguage } from "./main-menu-sender";
import { commitWithOutbound, finalizeOutbound } from "./transactional-outbound";
import type { FilingWorkflowResult } from "./filing-workflow";

/**
 * Implements #33 (Prototype parity — Phase 5) Part F: court selection, the
 * single combined review across every field collected in Parts A-F, the
 * 2-level edit picker (only Parts C/D/F's own fields — Parts A/B already
 * have their own dedicated #10/#11 review/edit loop, not re-litigated
 * here), and the declaration checkbox, cascading into #34 (Prototype
 * parity — Phase 6)'s FILING_DRAFT_READY, sending its draft-ready summary
 * + actions directly (via filing-sign-sender.ts, a leaf module) after the
 * declaration acknowledgment.
 *
 * This file must never import from filing-workflow.ts or from
 * filing-sign-workflow.ts — filing-workflow.ts imports
 * `resendFilingReviewPromptForResume` from here, and filing-sign-workflow.ts
 * imports it too (for the "Edit details" cascade back into Phase 5), so the
 * dependency only ever runs one way.
 */

export interface FilingReviewWorkflowDeps {
  conversationRepo: ConversationRepository;
  filingRepo: FilingRepository;
  /** Both COMPLAINANT and ACCUSED rows are read here — the review recaps every field across Parts A-F, never just this file's own fields. */
  partyRepo: FilingPartyRepository;
  /** Read-only: only used to check whether Part E's optional written-account group has any files, never to list/download them. */
  filingDocumentRepo: FilingDocumentRepository;
  /** Durable outbound intent, enqueued inside the same transaction as each committed state change — see commitWithOutbound in transactional-outbound.ts. */
  outboundMessageRepo: OutboundMessageRepository;
  filingDetailsSenderDeps: FilingDetailsSenderDeps;
  /** Reused as-is for "back to main menu" after save-and-exit — never a second implementation. */
  mainMenuSenderDeps: MainMenuSenderDeps;
  /** #34: used only to send the draft-ready summary + actions once the declaration cascades into FILING_DRAFT_READY — never a second implementation of that copy. */
  filingSignSenderDeps: FilingSignSenderDeps;
  withTransaction: <T>(fn: (tx: RepositoryTransaction) => Promise<T>) => Promise<T>;
}

export interface FilingReviewActionInput {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
  selection: FilingDetailSelectionInput;
}

export interface FilingReviewFieldInputEvent {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
  text: string;
  mediaCount: number;
}

function sendInputFor(input: { whatsappNumber: string; language: SupportedLanguage; messageId: string }): SendFilingDetailsMessageInput {
  return { to: input.whatsappNumber, language: input.language, correlationId: input.messageId };
}

const SAVED_TEXT: Record<SupportedLanguage, string> = {
  en: "✓ Your filing draft has been saved. You can resume it from the main menu.",
  ml: "✓ നിങ്ങളുടെ ഫയലിംഗ് ഡ്രാഫ്റ്റ് സേവ് ചെയ്തു. നിങ്ങൾക്ക് പ്രധാന മെനുവിൽ നിന്ന് ഇത് തുടരാം.",
};

const RECORDED_TEXT: Record<SupportedLanguage, string> = {
  en: "✓ Declaration recorded.",
  ml: "✓ പ്രഖ്യാപനം രേഖപ്പെടുത്തി.",
};

/** Every currentStep #33 Part F can resume into — combined with the other sets in filing-workflow.ts's SUPPORTED_FILING_STEPS. */
export const FILING_REVIEW_SUPPORTED_FILING_STEPS: ReadonlySet<string> = new Set([
  "FILING_COURT_PENDING",
  "FILING_REVIEW",
  "FILING_EDIT_GROUP_PENDING",
  "FILING_EDIT_CHEQUE_FIELD_PENDING",
  "FILING_EDIT_NARRATIVE_FIELD_PENDING",
  "FILING_EDIT_CHEQUE_NUMBER_PENDING",
  "FILING_EDIT_CHEQUE_DATE_PENDING",
  "FILING_EDIT_AMOUNT_PENDING",
  "FILING_EDIT_BANK_BRANCH_PENDING",
  "FILING_EDIT_RETURN_REASON_PENDING",
  "FILING_EDIT_MEMO_DATE_PENDING",
  "FILING_EDIT_NOTICE_DATE_PENDING",
  "FILING_EDIT_SERVICE_DATE_PENDING",
  "FILING_EDIT_PART_PAYMENT_PENDING",
  "FILING_EDIT_STORY_PENDING",
  "FILING_EDIT_WITNESS_PENDING",
  "FILING_EDIT_COURT_PENDING",
  "FILING_DECLARE_PENDING",
]);

// Every cheque/notice-group field the review's edit picker can reach, and
// which conversation state answering it goes through. `returnReason` and
// `partPayment` are selections (see SELECTION_FIELD_SENDER below); the rest
// are plain text, reusing filing-details-workflow.ts's own validator/copy.
const CHEQUE_FIELD_EDIT_STATE: Record<FilingChequeEditField, ConversationState> = {
  chequeNumber: "FILING_EDIT_CHEQUE_NUMBER_PENDING",
  chequeDate: "FILING_EDIT_CHEQUE_DATE_PENDING",
  amount: "FILING_EDIT_AMOUNT_PENDING",
  bankBranch: "FILING_EDIT_BANK_BRANCH_PENDING",
  returnReason: "FILING_EDIT_RETURN_REASON_PENDING",
  memoDate: "FILING_EDIT_MEMO_DATE_PENDING",
  noticeDate: "FILING_EDIT_NOTICE_DATE_PENDING",
  serviceDate: "FILING_EDIT_SERVICE_DATE_PENDING",
  partPayment: "FILING_EDIT_PART_PAYMENT_PENDING",
};

const NARRATIVE_FIELD_EDIT_STATE: Record<FilingNarrativeEditField, ConversationState> = {
  story: "FILING_EDIT_STORY_PENDING",
  witness: "FILING_EDIT_WITNESS_PENDING",
  court: "FILING_EDIT_COURT_PENDING",
};

const TEXT_FIELD_OUTBOUND_TYPE: Record<TextFieldKey, OutboundMessageType> = {
  chequeNumber: "FILING_CHEQUE_NUMBER_PROMPT",
  chequeDate: "FILING_CHEQUE_DATE_PROMPT",
  amount: "FILING_AMOUNT_PROMPT",
  bankBranch: "FILING_BANK_BRANCH_PROMPT",
  memoDate: "FILING_MEMO_DATE_PROMPT",
  noticeDate: "FILING_NOTICE_DATE_PROMPT",
  serviceDate: "FILING_SERVICE_DATE_PROMPT",
  story: "FILING_STORY_PROMPT",
};

const TEXT_FIELDS: ReadonlySet<string> = new Set(Object.keys(TEXT_FIELD_OUTBOUND_TYPE));

function isTextField(field: FilingChequeEditField | FilingNarrativeEditField): field is TextFieldKey {
  return TEXT_FIELDS.has(field);
}

// ---------------------------------------------------------------------------
// Read-only helpers
// ---------------------------------------------------------------------------

async function fetchReviewData(
  deps: FilingReviewWorkflowDeps,
  filingId: string,
): Promise<{ filing: FilingRecord; complainant: FilingPartyRecord; accused: FilingPartyRecord; hasWrittenAccount: boolean } | null> {
  return deps.withTransaction(async (tx) => {
    const filing = await deps.filingRepo.lockById(tx, filingId).catch(() => null);
    if (!filing) {
      return null;
    }
    const complainant = await deps.partyRepo.findByFilingAndRole(tx, filingId, "COMPLAINANT");
    const accused = await deps.partyRepo.findByFilingAndRole(tx, filingId, "ACCUSED");
    if (!complainant || !accused) {
      return null;
    }
    const narrativeCount = await deps.filingDocumentRepo.countByGroup(tx, filingId, "narrative");
    return { filing, complainant, accused, hasWrittenAccount: narrativeCount > 0 };
  });
}

async function currentFilingIdForConversation(deps: FilingReviewWorkflowDeps, conversationId: string): Promise<string | null> {
  return deps.withTransaction(async (tx) => {
    const filing = await deps.filingRepo.findActiveDraft(tx, conversationId);
    return filing?.id ?? null;
  });
}

async function sendReviewSummaryAndActions(deps: FilingReviewWorkflowDeps, sendInput: SendFilingDetailsMessageInput, filingId: string): Promise<boolean> {
  const data = await fetchReviewData(deps, filingId);
  if (!data) {
    // Nothing to render (draft/party rows missing) — safe no-op.
    return true;
  }
  const summaryDelivered = await sendFilingReviewSummary(deps.filingDetailsSenderDeps, sendInput, data.filing, data.complainant, data.accused, data.hasWrittenAccount);
  const actionsDelivered = await sendFilingReviewActions(deps.filingDetailsSenderDeps, sendInput);
  return summaryDelivered && actionsDelivered;
}

// ---------------------------------------------------------------------------
// FILING_COURT_PENDING (Part F entry): the hardcoded 3-option select,
// cascading into FILING_REVIEW once answered.
// ---------------------------------------------------------------------------

export async function handleFilingCourtInput(deps: FilingReviewWorkflowDeps, input: FilingReviewActionInput): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);
  const court = parseCourtSelection(input.selection);

  if (!court) {
    return { delivered: await sendCourtPrompt(deps.filingDetailsSenderDeps, sendInput) };
  }

  let filingIdRef: string | null = null;
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_COURT_PENDING") {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    filingIdRef = filing.id;

    await deps.filingRepo.upsertFilingFields(tx, filing.id, { selectedCourt: court });
    await deps.filingRepo.setCurrentStep(tx, filing.id, "FILING_REVIEW");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_REVIEW");
    return {
      committed: true,
      sends: [
        { messageType: "FILING_REVIEW_SUMMARY" as const, dedupeSuffix: "filing-review-summary" },
        { messageType: "FILING_REVIEW_ACTIONS" as const, dedupeSuffix: "filing-review-actions" },
      ],
    };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const data = filingIdRef ? await fetchReviewData(deps, filingIdRef) : null;
  if (!data) {
    return { delivered: true };
  }
  const summaryDelivered = await sendFilingReviewSummary(deps.filingDetailsSenderDeps, sendInput, data.filing, data.complainant, data.accused, data.hasWrittenAccount);
  await finalizeOutbound(deps, commit.outboundIds[0], summaryDelivered);
  const actionsDelivered = await sendFilingReviewActions(deps.filingDetailsSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[1], actionsDelivered);
  return { delivered: summaryDelivered && actionsDelivered };
}

// ---------------------------------------------------------------------------
// FILING_REVIEW dispatch: Confirm / Edit / Save and exit.
// ---------------------------------------------------------------------------

export async function handleFilingReviewInput(deps: FilingReviewWorkflowDeps, input: FilingReviewActionInput): Promise<FilingWorkflowResult> {
  const action = parseFilingReviewAction(input.selection);

  if (!action) {
    const filingId = await currentFilingIdForConversation(deps, input.conversationId);
    if (!filingId) {
      return { delivered: true };
    }
    return { delivered: await sendReviewSummaryAndActions(deps, sendInputFor(input), filingId) };
  }

  if (action === "filing:confirm") {
    return openDeclarePrompt(deps, input);
  }
  if (action === "filing:edit") {
    return openEditGroupPicker(deps, input);
  }
  // filing:save-exit
  return saveAndExitFromReview(deps, input);
}

async function openDeclarePrompt(deps: FilingReviewWorkflowDeps, input: FilingReviewActionInput): Promise<FilingWorkflowResult> {
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_REVIEW") {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    await deps.filingRepo.setCurrentStep(tx, filing.id, "FILING_DECLARE_PENDING");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_DECLARE_PENDING");
    return { committed: true, sends: [{ messageType: "FILING_DECLARE_PROMPT" as const, dedupeSuffix: "filing-declare-prompt" }] };
  });

  if (!commit.committed) {
    return { delivered: true };
  }
  const delivered = await sendFilingDeclarePrompt(deps.filingDetailsSenderDeps, sendInputFor(input));
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

async function openEditGroupPicker(deps: FilingReviewWorkflowDeps, input: FilingReviewActionInput): Promise<FilingWorkflowResult> {
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_REVIEW") {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    await deps.filingRepo.setCurrentStep(tx, filing.id, "FILING_EDIT_GROUP_PENDING");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_EDIT_GROUP_PENDING");
    return { committed: true, sends: [{ messageType: "FILING_EDIT_GROUP_PROMPT" as const, dedupeSuffix: "filing-edit-group-prompt" }] };
  });

  if (!commit.committed) {
    return { delivered: true };
  }
  const delivered = await sendFilingEditGroupPrompt(deps.filingDetailsSenderDeps, sendInputFor(input));
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

async function saveAndExitFromReview(deps: FilingReviewWorkflowDeps, input: FilingReviewActionInput): Promise<FilingWorkflowResult> {
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_REVIEW") {
      return { committed: false };
    }
    // Keeps filing.current_step FILING_REVIEW and active_filing_id exactly
    // as-is — only the conversation moves (mirrors #10/#11's save-and-exit).
    await deps.conversationRepo.setStateInTx(tx, locked.id, "MAIN_MENU");
    return {
      committed: true,
      sends: [
        { messageType: "FILING_SAVED" as const, dedupeSuffix: "filing-saved" },
        { messageType: "MAIN_MENU" as const, dedupeSuffix: "main-menu" },
      ],
    };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const sendInput = sendInputFor(input);
  const savedDelivered = await sendFilingPlainText(deps.filingDetailsSenderDeps, sendInput, SAVED_TEXT[input.language], "filing_saved_send_failed");
  await finalizeOutbound(deps, commit.outboundIds[0], savedDelivered);
  const menuDelivered = await sendMainMenu(deps.mainMenuSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[1], menuDelivered);
  return { delivered: savedDelivered && menuDelivered };
}

// ---------------------------------------------------------------------------
// FILING_EDIT_GROUP_PENDING: choose which group to edit (Cheque & notice /
// Story, witness & court) — the first level of the 2-level edit picker.
// ---------------------------------------------------------------------------

export async function handleFilingEditGroupInput(deps: FilingReviewWorkflowDeps, input: FilingReviewActionInput): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);
  const group = parseFilingEditGroupSelection(input.selection);

  if (!group) {
    return { delivered: await sendFilingEditGroupPrompt(deps.filingDetailsSenderDeps, sendInput) };
  }

  const nextState: ConversationState = group === "cheque" ? "FILING_EDIT_CHEQUE_FIELD_PENDING" : "FILING_EDIT_NARRATIVE_FIELD_PENDING";
  const outboundType: OutboundMessageType = group === "cheque" ? "FILING_EDIT_CHEQUE_FIELD_PROMPT" : "FILING_EDIT_NARRATIVE_FIELD_PROMPT";

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_EDIT_GROUP_PENDING") {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    await deps.filingRepo.setCurrentStep(tx, filing.id, nextState);
    await deps.conversationRepo.setStateInTx(tx, locked.id, nextState);
    return { committed: true, sends: [{ messageType: outboundType, dedupeSuffix: `${group}-field-prompt` }] };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const delivered =
    group === "cheque"
      ? await sendFilingEditChequeFieldPrompt(deps.filingDetailsSenderDeps, sendInput)
      : await sendFilingEditNarrativeFieldPrompt(deps.filingDetailsSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

// ---------------------------------------------------------------------------
// FILING_EDIT_CHEQUE_FIELD_PENDING / FILING_EDIT_NARRATIVE_FIELD_PENDING:
// the 2nd-level pickers, each dispatching into that one field's own
// EDIT_*_PENDING state.
// ---------------------------------------------------------------------------

async function openFieldEditState(
  deps: FilingReviewWorkflowDeps,
  input: FilingReviewActionInput,
  fromState: ConversationState,
  field: FilingChequeEditField | FilingNarrativeEditField,
  nextState: ConversationState,
): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== fromState) {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    await deps.filingRepo.setCurrentStep(tx, filing.id, nextState);
    await deps.conversationRepo.setStateInTx(tx, locked.id, nextState);

    if (isTextField(field)) {
      return { committed: true, sends: [{ messageType: TEXT_FIELD_OUTBOUND_TYPE[field], dedupeSuffix: `edit-${field}-prompt` }] };
    }
    return { committed: true, sends: [{ messageType: SELECTION_FIELD_OUTBOUND_TYPE[field], dedupeSuffix: `edit-${field}-prompt` }] };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const delivered = isTextField(field)
    ? await sendFilingPlainText(deps.filingDetailsSenderDeps, sendInput, FILING_DETAILS_PROMPT_TEXT[field][input.language], `filing_edit_${field}_prompt_send_failed`)
    : await SELECTION_FIELD_SENDER[field](deps.filingDetailsSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

const SELECTION_FIELD_OUTBOUND_TYPE: Record<"returnReason" | "partPayment" | "witness" | "court", OutboundMessageType> = {
  returnReason: "FILING_RETURN_REASON_PROMPT",
  partPayment: "FILING_PART_PAYMENT_PROMPT",
  witness: "FILING_WITNESS_PROMPT",
  court: "FILING_COURT_PROMPT",
};

const SELECTION_FIELD_SENDER: Record<"returnReason" | "partPayment" | "witness" | "court", (deps: FilingDetailsSenderDeps, input: SendFilingDetailsMessageInput) => Promise<boolean>> = {
  returnReason: sendReturnReasonPrompt,
  partPayment: sendPartPaymentPrompt,
  witness: sendWitnessPrompt,
  court: sendCourtPrompt,
};

export async function handleFilingEditChequeFieldInput(deps: FilingReviewWorkflowDeps, input: FilingReviewActionInput): Promise<FilingWorkflowResult> {
  const field = parseFilingChequeEditFieldSelection(input.selection);
  if (!field) {
    return { delivered: await sendFilingEditChequeFieldPrompt(deps.filingDetailsSenderDeps, sendInputFor(input)) };
  }
  return openFieldEditState(deps, input, "FILING_EDIT_CHEQUE_FIELD_PENDING", field, CHEQUE_FIELD_EDIT_STATE[field]);
}

export async function handleFilingEditNarrativeFieldInput(deps: FilingReviewWorkflowDeps, input: FilingReviewActionInput): Promise<FilingWorkflowResult> {
  const field = parseFilingNarrativeEditFieldSelection(input.selection);
  if (!field) {
    return { delivered: await sendFilingEditNarrativeFieldPrompt(deps.filingDetailsSenderDeps, sendInputFor(input)) };
  }
  return openFieldEditState(deps, input, "FILING_EDIT_NARRATIVE_FIELD_PENDING", field, NARRATIVE_FIELD_EDIT_STATE[field]);
}

// ---------------------------------------------------------------------------
// Per-field EDIT_*_PENDING input: validates/parses exactly one replacement
// value, then always returns to FILING_REVIEW (mirrors #10/#11's "only this
// one field changes" guarantee).
// ---------------------------------------------------------------------------

async function returnToReview(deps: FilingReviewWorkflowDeps, filingId: string, sendInput: SendFilingDetailsMessageInput, outboundIds: string[]): Promise<boolean> {
  const data = await fetchReviewData(deps, filingId);
  if (!data) {
    return true;
  }
  const summaryDelivered = await sendFilingReviewSummary(deps.filingDetailsSenderDeps, sendInput, data.filing, data.complainant, data.accused, data.hasWrittenAccount);
  await finalizeOutbound(deps, outboundIds[0], summaryDelivered);
  const actionsDelivered = await sendFilingReviewActions(deps.filingDetailsSenderDeps, sendInput);
  await finalizeOutbound(deps, outboundIds[1], actionsDelivered);
  return summaryDelivered && actionsDelivered;
}

export async function handleFilingEditTextFieldInput(deps: FilingReviewWorkflowDeps, field: TextFieldKey, input: FilingReviewFieldInputEvent): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);
  const fromState = CHEQUE_FIELD_EDIT_STATE[field as FilingChequeEditField] ?? NARRATIVE_FIELD_EDIT_STATE[field as FilingNarrativeEditField];

  if (input.mediaCount > 0 && !input.text.trim()) {
    return { delivered: await sendFilingPlainText(deps.filingDetailsSenderDeps, sendInput, FILING_DETAILS_ERROR_TEXT[field][sendInput.language], `filing_edit_${field}_validation_error_send_failed`) };
  }
  const validation = validateFilingDetailsTextField(field, input.text);
  if (!validation.valid || !validation.patch) {
    return { delivered: await sendFilingPlainText(deps.filingDetailsSenderDeps, sendInput, FILING_DETAILS_ERROR_TEXT[field][sendInput.language], `filing_edit_${field}_validation_error_send_failed`) };
  }
  const patch = validation.patch;

  let filingIdRef: string | null = null;
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== fromState) {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    filingIdRef = filing.id;

    if (Object.keys(patch).length > 0) {
      await deps.filingRepo.upsertFilingFields(tx, filing.id, patch);
    }
    await deps.filingRepo.setCurrentStep(tx, filing.id, "FILING_REVIEW");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_REVIEW");
    return {
      committed: true,
      sends: [
        { messageType: "FILING_REVIEW_SUMMARY" as const, dedupeSuffix: "filing-review-summary" },
        { messageType: "FILING_REVIEW_ACTIONS" as const, dedupeSuffix: "filing-review-actions" },
      ],
    };
  });

  if (!commit.committed) {
    return { delivered: true };
  }
  return { delivered: filingIdRef ? await returnToReview(deps, filingIdRef, sendInput, commit.outboundIds) : true };
}

export function handleFilingEditChequeNumberInput(deps: FilingReviewWorkflowDeps, input: FilingReviewFieldInputEvent): Promise<FilingWorkflowResult> {
  return handleFilingEditTextFieldInput(deps, "chequeNumber", input);
}
export function handleFilingEditChequeDateInput(deps: FilingReviewWorkflowDeps, input: FilingReviewFieldInputEvent): Promise<FilingWorkflowResult> {
  return handleFilingEditTextFieldInput(deps, "chequeDate", input);
}
export function handleFilingEditAmountInput(deps: FilingReviewWorkflowDeps, input: FilingReviewFieldInputEvent): Promise<FilingWorkflowResult> {
  return handleFilingEditTextFieldInput(deps, "amount", input);
}
export function handleFilingEditBankBranchInput(deps: FilingReviewWorkflowDeps, input: FilingReviewFieldInputEvent): Promise<FilingWorkflowResult> {
  return handleFilingEditTextFieldInput(deps, "bankBranch", input);
}
export function handleFilingEditMemoDateInput(deps: FilingReviewWorkflowDeps, input: FilingReviewFieldInputEvent): Promise<FilingWorkflowResult> {
  return handleFilingEditTextFieldInput(deps, "memoDate", input);
}
export function handleFilingEditNoticeDateInput(deps: FilingReviewWorkflowDeps, input: FilingReviewFieldInputEvent): Promise<FilingWorkflowResult> {
  return handleFilingEditTextFieldInput(deps, "noticeDate", input);
}
export function handleFilingEditServiceDateInput(deps: FilingReviewWorkflowDeps, input: FilingReviewFieldInputEvent): Promise<FilingWorkflowResult> {
  return handleFilingEditTextFieldInput(deps, "serviceDate", input);
}
export function handleFilingEditStoryInput(deps: FilingReviewWorkflowDeps, input: FilingReviewFieldInputEvent): Promise<FilingWorkflowResult> {
  return handleFilingEditTextFieldInput(deps, "story", input);
}

async function handleEditSelectionFieldInput(
  deps: FilingReviewWorkflowDeps,
  field: "returnReason" | "partPayment" | "witness" | "court",
  fromState: ConversationState,
  parse: (input: FilingDetailSelectionInput) => unknown,
  patchKey: "returnReason" | "partPayment" | "witnessPresent" | "selectedCourt",
  input: FilingReviewActionInput,
): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);
  const value = parse(input.selection);

  if (field === "returnReason") {
    // Optional — Skip is a valid, meaningful answer (leaves it unset, just
    // advances), but only for a typed reply with no stable ID at all — a
    // stable ID (button tap) is either the reason itself or unrecognized,
    // never a fallback into Skip-checking.
    const hasStableId = Boolean(input.selection.buttonPayload || input.selection.listId);
    if (!value && !(!hasStableId && isSkipSelection(input.selection))) {
      return { delivered: await SELECTION_FIELD_SENDER[field](deps.filingDetailsSenderDeps, sendInput) };
    }
  } else if (value === null || value === undefined) {
    return { delivered: await SELECTION_FIELD_SENDER[field](deps.filingDetailsSenderDeps, sendInput) };
  }

  let filingIdRef: string | null = null;
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== fromState) {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    filingIdRef = filing.id;

    if (value !== null && value !== undefined) {
      await deps.filingRepo.upsertFilingFields(tx, filing.id, { [patchKey]: value } as Record<string, unknown>);
    }
    await deps.filingRepo.setCurrentStep(tx, filing.id, "FILING_REVIEW");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_REVIEW");
    return {
      committed: true,
      sends: [
        { messageType: "FILING_REVIEW_SUMMARY" as const, dedupeSuffix: "filing-review-summary" },
        { messageType: "FILING_REVIEW_ACTIONS" as const, dedupeSuffix: "filing-review-actions" },
      ],
    };
  });

  if (!commit.committed) {
    return { delivered: true };
  }
  return { delivered: filingIdRef ? await returnToReview(deps, filingIdRef, sendInput, commit.outboundIds) : true };
}

export function handleFilingEditReturnReasonInput(deps: FilingReviewWorkflowDeps, input: FilingReviewActionInput): Promise<FilingWorkflowResult> {
  return handleEditSelectionFieldInput(deps, "returnReason", "FILING_EDIT_RETURN_REASON_PENDING", parseReturnReasonSelection, "returnReason", input);
}
export function handleFilingEditPartPaymentInput(deps: FilingReviewWorkflowDeps, input: FilingReviewActionInput): Promise<FilingWorkflowResult> {
  return handleEditSelectionFieldInput(deps, "partPayment", "FILING_EDIT_PART_PAYMENT_PENDING", parsePartPaymentSelection, "partPayment", input);
}
export function handleFilingEditWitnessInput(deps: FilingReviewWorkflowDeps, input: FilingReviewActionInput): Promise<FilingWorkflowResult> {
  return handleEditSelectionFieldInput(deps, "witness", "FILING_EDIT_WITNESS_PENDING", parseWitnessSelection, "witnessPresent", input);
}
export function handleFilingEditCourtInput(deps: FilingReviewWorkflowDeps, input: FilingReviewActionInput): Promise<FilingWorkflowResult> {
  return handleEditSelectionFieldInput(deps, "court", "FILING_EDIT_COURT_PENDING", parseCourtSelection, "selectedCourt", input);
}

// ---------------------------------------------------------------------------
// FILING_DECLARE_PENDING: the declaration checkbox, cascading into
// Prototype parity - Phase 6 once accepted.
// ---------------------------------------------------------------------------

export async function handleFilingDeclareInput(deps: FilingReviewWorkflowDeps, input: FilingReviewActionInput): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);
  const action = parseFilingDeclareAction(input.selection);

  if (!action) {
    return { delivered: await sendFilingDeclarePrompt(deps.filingDetailsSenderDeps, sendInput) };
  }

  if (action === "filing:save-exit") {
    const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
      if (locked.state !== "FILING_DECLARE_PENDING") {
        return { committed: false };
      }
      await deps.conversationRepo.setStateInTx(tx, locked.id, "MAIN_MENU");
      return {
        committed: true,
        sends: [
          { messageType: "FILING_SAVED" as const, dedupeSuffix: "filing-saved" },
          { messageType: "MAIN_MENU" as const, dedupeSuffix: "main-menu" },
        ],
      };
    });
    if (!commit.committed) {
      return { delivered: true };
    }
    const savedDelivered = await sendFilingPlainText(deps.filingDetailsSenderDeps, sendInput, SAVED_TEXT[input.language], "filing_saved_send_failed");
    await finalizeOutbound(deps, commit.outboundIds[0], savedDelivered);
    const menuDelivered = await sendMainMenu(deps.mainMenuSenderDeps, sendInput);
    await finalizeOutbound(deps, commit.outboundIds[1], menuDelivered);
    return { delivered: savedDelivered && menuDelivered };
  }

  // filing:declare-accept
  let updatedFiling: FilingRecord | null = null;
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_DECLARE_PENDING") {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    await deps.filingRepo.recordDeclaration(tx, filing.id, new Date());
    // Cascades straight into #34 (Prototype parity - Phase 6)'s
    // FILING_DRAFT_READY — never left resting at an intermediate state
    // (mirrors every other section's cascade in this codebase).
    await deps.filingRepo.setCurrentStep(tx, filing.id, "FILING_DRAFT_READY");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_DRAFT_READY");
    updatedFiling = { ...filing, currentStep: "FILING_DRAFT_READY" };
    return {
      committed: true,
      sends: [
        { messageType: "FILING_RECORDED" as const, dedupeSuffix: "filing-recorded" },
        { messageType: "FILING_DRAFT_READY_SUMMARY" as const, dedupeSuffix: "filing-draft-ready-summary" },
        { messageType: "FILING_DRAFT_READY_ACTIONS" as const, dedupeSuffix: "filing-draft-ready-actions" },
      ],
    };
  });

  if (!commit.committed || !updatedFiling) {
    return { delivered: true };
  }
  const recordedDelivered = await sendFilingPlainText(deps.filingDetailsSenderDeps, sendInput, RECORDED_TEXT[input.language], "filing_recorded_send_failed");
  await finalizeOutbound(deps, commit.outboundIds[0], recordedDelivered);
  const summaryDelivered = await sendDraftReadySummary(deps.filingSignSenderDeps, sendInput, updatedFiling);
  await finalizeOutbound(deps, commit.outboundIds[1], summaryDelivered);
  const actionsDelivered = await sendDraftReadyActions(deps.filingSignSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[2], actionsDelivered);
  return { delivered: recordedDelivered && summaryDelivered && actionsDelivered };
}

// ---------------------------------------------------------------------------
// Resume support for #8's filing-workflow.ts.
// ---------------------------------------------------------------------------

const TEXT_EDIT_STATE_TO_FIELD: Partial<Record<string, TextFieldKey>> = {
  FILING_EDIT_CHEQUE_NUMBER_PENDING: "chequeNumber",
  FILING_EDIT_CHEQUE_DATE_PENDING: "chequeDate",
  FILING_EDIT_AMOUNT_PENDING: "amount",
  FILING_EDIT_BANK_BRANCH_PENDING: "bankBranch",
  FILING_EDIT_MEMO_DATE_PENDING: "memoDate",
  FILING_EDIT_NOTICE_DATE_PENDING: "noticeDate",
  FILING_EDIT_SERVICE_DATE_PENDING: "serviceDate",
  FILING_EDIT_STORY_PENDING: "story",
};

const SELECTION_EDIT_STATE_TO_SENDER: Partial<Record<string, (deps: FilingDetailsSenderDeps, input: SendFilingDetailsMessageInput) => Promise<boolean>>> = {
  FILING_EDIT_RETURN_REASON_PENDING: sendReturnReasonPrompt,
  FILING_EDIT_PART_PAYMENT_PENDING: sendPartPaymentPrompt,
  FILING_EDIT_WITNESS_PENDING: sendWitnessPrompt,
  FILING_EDIT_COURT_PENDING: sendCourtPrompt,
};

/** Resends whatever the advocate should see for a draft resumed into one of Part F's steps. Read-only: never mutates anything. */
export async function resendFilingReviewPromptForResume(deps: FilingReviewWorkflowDeps, filing: FilingRecord, sendInput: SendFilingDetailsMessageInput): Promise<boolean> {
  const step = filing.currentStep;

  if (step === "FILING_COURT_PENDING") {
    return sendCourtPrompt(deps.filingDetailsSenderDeps, sendInput);
  }
  if (step === "FILING_REVIEW") {
    return sendReviewSummaryAndActions(deps, sendInput, filing.id);
  }
  if (step === "FILING_EDIT_GROUP_PENDING") {
    return sendFilingEditGroupPrompt(deps.filingDetailsSenderDeps, sendInput);
  }
  if (step === "FILING_EDIT_CHEQUE_FIELD_PENDING") {
    return sendFilingEditChequeFieldPrompt(deps.filingDetailsSenderDeps, sendInput);
  }
  if (step === "FILING_EDIT_NARRATIVE_FIELD_PENDING") {
    return sendFilingEditNarrativeFieldPrompt(deps.filingDetailsSenderDeps, sendInput);
  }
  if (step === "FILING_DECLARE_PENDING") {
    return sendFilingDeclarePrompt(deps.filingDetailsSenderDeps, sendInput);
  }

  const textField = TEXT_EDIT_STATE_TO_FIELD[step];
  if (textField) {
    return sendFilingPlainText(deps.filingDetailsSenderDeps, sendInput, FILING_DETAILS_PROMPT_TEXT[textField][sendInput.language], `filing_edit_${textField}_resume_prompt_send_failed`);
  }

  const selectionSender = SELECTION_EDIT_STATE_TO_SENDER[step];
  if (selectionSender) {
    return selectionSender(deps.filingDetailsSenderDeps, sendInput);
  }

  // Unreachable given filing-workflow.ts only calls this for steps in FILING_REVIEW_SUPPORTED_FILING_STEPS.
  return false;
}
