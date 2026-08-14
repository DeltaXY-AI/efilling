import { parseEnrolmentConfirmAction, validateEnrolmentNumber, type EnrolmentSelectionInput } from "../domain/enrolment";
import type { ConversationRepository } from "../repositories/conversation-repository";
import type { FilingRepository } from "../repositories/filing-repository";
import type { OutboundMessageRepository } from "../repositories/outbound-message-repository";
import type { RepositoryTransaction } from "../repositories/transaction";
import type { ComplainantSenderDeps } from "./complainant-sender";
import { sendFilingDocChequePrompt } from "./filing-document-workflow";
import { sendEnrolmentConfirmation, sendEnrolmentPrompt, type EnrolmentSenderDeps } from "./enrolment-sender";
import type { FilingWorkflowResult } from "./filing-workflow";
import { sendFilingPlainText } from "./filing-sender";
import { sendMainMenu, type MainMenuSenderDeps, type SupportedLanguage } from "./main-menu-sender";
import { commitWithOutbound, finalizeOutbound } from "./transactional-outbound";

export interface EnrolmentWorkflowDeps {
  conversationRepo: ConversationRepository;
  filingRepo: FilingRepository;
  /** Durable outbound intent, enqueued inside the same transaction as each committed state change — see commitWithOutbound in transactional-outbound.ts. */
  outboundMessageRepo: OutboundMessageRepository;
  enrolmentSenderDeps: EnrolmentSenderDeps;
  /** Reused as-is for "back to main menu" after save-and-exit — never a second implementation. */
  mainMenuSenderDeps: MainMenuSenderDeps;
  /** No longer read directly by this file since #31 (Confirm now cascades into FILING_DOC_CHEQUE, not COMPLAINANT_NAME_PENDING) — kept in this deps shape so every existing call site (twilio-webhook.route.ts, tests) that already constructs it does not need to change. */
  complainantSenderDeps: ComplainantSenderDeps;
  withTransaction: <T>(fn: (tx: RepositoryTransaction) => Promise<T>) => Promise<T>;
}

export interface EnrolmentInputEvent {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
  text: string;
  /** Number of media attachments on the inbound message (Part F: media-only input is rejected the same as any other invalid input). */
  mediaCount: number;
}

export interface EnrolmentActionInput {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
  selection: EnrolmentSelectionInput;
}

const VALIDATION_ERROR_TEXT: Record<SupportedLanguage, string> = {
  en: ["That enrolment number does not appear to be in a supported format.", "", "Enter 5–30 letters and numbers using / or - where needed.", "", "Example: KER/1234/2010"].join(
    "\n",
  ),
  ml: [
    "ആ എൻറോൾമെന്റ് നമ്പർ പിന്തുണയുള്ള ഫോർമാറ്റിൽ ആണെന്ന് തോന്നുന്നില്ല.",
    "",
    "ആവശ്യമെങ്കിൽ / അല്ലെങ്കിൽ - ഉപയോഗിച്ച് 5–30 അക്ഷരങ്ങളും അക്കങ്ങളും നൽകുക.",
    "",
    "ഉദാഹരണം: KER/1234/2010",
  ].join("\n"),
};

// #31: the cascade now leads into document collection, not straight into
// complainant details — updated to match (was "...collect the
// complainant's details.").
const RECORDED_TEXT: Record<SupportedLanguage, string> = {
  en: "✓ Advocate enrolment number recorded.\n\nThis number has not been externally verified.\n\nNext, we will collect the case documents.",
  ml: "✓ അഭിഭാഷക എൻറോൾമെന്റ് നമ്പർ രേഖപ്പെടുത്തി.\n\nഈ നമ്പർ പുറത്തുനിന്ന് പരിശോധിച്ചിട്ടില്ല.\n\nഅടുത്തതായി കേസ് രേഖകൾ ശേഖരിക്കും.",
};

const SAVED_TEXT: Record<SupportedLanguage, string> = {
  en: "✓ Your filing draft has been saved. You can resume it from the main menu.",
  ml: "✓ നിങ്ങളുടെ ഫയലിംഗ് ഡ്രാഫ്റ്റ് സേവ് ചെയ്തു. നിങ്ങൾക്ക് പ്രധാന മെനുവിൽ നിന്ന് ഇത് തുടരാം.",
};

function sendInputFor(input: { whatsappNumber: string; language: SupportedLanguage; messageId: string }) {
  return { to: input.whatsappNumber, language: input.language, correlationId: input.messageId };
}

/** Read-only lookup of the active draft's normalized candidate, for redisplaying the confirmation on unrecognized input — never mutates anything. */
async function currentCandidateNormalized(deps: EnrolmentWorkflowDeps, conversationId: string): Promise<string | null> {
  return deps.withTransaction(async (tx) => {
    const filing = await deps.filingRepo.findActiveDraft(tx, conversationId);
    return filing?.advocateEnrolmentNormalized ?? null;
  });
}

/**
 * Handles a typed enrolment number while at ADVOCATE_ENROLMENT_PENDING (#9
 * Part F). Media-only input and anything failing `validateEnrolmentNumber`
 * never touch the database — only a valid number locks the conversation,
 * saves the candidate on the active draft, and transitions to
 * ADVOCATE_ENROLMENT_CONFIRM. A stale re-delivery (conversation no longer
 * ADVOCATE_ENROLMENT_PENDING, or no active draft to attach to) is a safe
 * no-op.
 */
export async function handleEnrolmentInput(deps: EnrolmentWorkflowDeps, input: EnrolmentInputEvent): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);

  if (input.mediaCount > 0 && !input.text.trim()) {
    return {
      delivered: await sendFilingPlainText(deps.enrolmentSenderDeps, sendInput, VALIDATION_ERROR_TEXT[input.language], "enrolment_validation_error_send_failed"),
    };
  }

  const result = validateEnrolmentNumber(input.text);
  if (!result.valid || !result.normalized) {
    return {
      delivered: await sendFilingPlainText(deps.enrolmentSenderDeps, sendInput, VALIDATION_ERROR_TEXT[input.language], "enrolment_validation_error_send_failed"),
    };
  }
  const normalized = result.normalized;

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "ADVOCATE_ENROLMENT_PENDING") {
      return { committed: false };
    }

    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      // No active draft to attach the candidate to — never silently guess
      // or create one; treat as stale.
      return { committed: false };
    }

    await deps.filingRepo.saveEnrolmentCandidate(tx, filing.id, { original: result.original, normalized });
    await deps.conversationRepo.setStateInTx(tx, locked.id, "ADVOCATE_ENROLMENT_CONFIRM");
    return { committed: true, sends: [{ messageType: "ADVOCATE_ENROLMENT_CONFIRM" as const, dedupeSuffix: "enrolment-confirm" }] };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const delivered = await sendEnrolmentConfirmation(deps.enrolmentSenderDeps, sendInput, normalized);
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

/**
 * Dispatches input while at ADVOCATE_ENROLMENT_CONFIRM (#9 Parts G/H/I):
 * Confirm records the candidate as unverified and cascades straight into
 * FILING_DOC_CHEQUE, sending the first document-upload prompt in the same
 * transaction (#31, replacing #10 Part A's original COMPLAINANT_NAME_PENDING
 * target); Edit clears the candidate and returns to
 * ADVOCATE_ENROLMENT_PENDING; Save and exit preserves everything and
 * returns to MAIN_MENU. Unrecognized input redisplays the confirmation
 * with the current candidate, without changing state.
 */
export async function handleEnrolmentConfirmInput(deps: EnrolmentWorkflowDeps, input: EnrolmentActionInput): Promise<FilingWorkflowResult> {
  const action = parseEnrolmentConfirmAction(input.selection);
  const sendInput = sendInputFor(input);

  if (!action) {
    const normalized = await currentCandidateNormalized(deps, input.conversationId);
    if (!normalized) {
      // Nothing to redisplay (draft/candidate already gone) — safe no-op.
      return { delivered: true };
    }
    return { delivered: await sendEnrolmentConfirmation(deps.enrolmentSenderDeps, sendInput, normalized) };
  }

  if (action === "enrolment:confirm") {
    return confirmEnrolment(deps, input);
  }

  if (action === "enrolment:edit") {
    return editEnrolment(deps, input);
  }

  // filing:save-exit
  return saveAndExit(deps, input);
}

async function confirmEnrolment(deps: EnrolmentWorkflowDeps, input: EnrolmentActionInput): Promise<FilingWorkflowResult> {
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "ADVOCATE_ENROLMENT_CONFIRM") {
      return { committed: false };
    }

    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }

    // #9 Part K: lock the filing itself too, so a concurrent Confirm/Edit
    // on the same filing serializes — only the first valid transition wins.
    const lockedFiling = await deps.filingRepo.lockById(tx, filing.id);
    if (lockedFiling.currentStep !== "ADVOCATE_ENROLMENT_CONFIRM" || !lockedFiling.advocateEnrolmentNormalized) {
      return { committed: false };
    }

    await deps.filingRepo.confirmEnrolment(tx, lockedFiling.id, new Date());
    // #31: the "state entry" transition now goes to FILING_DOC_CHEQUE, the
    // first of 5 document-upload groups, right here in the same transaction
    // — never left resting at an intermediate state waiting for another
    // inbound message. Complainant details (#10) are collected only after
    // all 5 groups are done (see filing-document-workflow.ts).
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_DOC_CHEQUE");
    return {
      committed: true,
      sends: [
        { messageType: "ADVOCATE_ENROLMENT_RECORDED" as const, dedupeSuffix: "enrolment-recorded" },
        { messageType: "FILING_DOC_CHEQUE_PROMPT" as const, dedupeSuffix: "filing-doc-cheque-prompt" },
      ],
    };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const sendInput = sendInputFor(input);
  const delivered = await sendFilingPlainText(
    deps.enrolmentSenderDeps,
    sendInput,
    RECORDED_TEXT[input.language],
    "enrolment_recorded_confirmation_send_failed",
  );
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);

  const chequePromptDelivered = await sendFilingDocChequePrompt(deps.enrolmentSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[1], chequePromptDelivered);

  return { delivered: delivered && chequePromptDelivered };
}

async function editEnrolment(deps: EnrolmentWorkflowDeps, input: EnrolmentActionInput): Promise<FilingWorkflowResult> {
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "ADVOCATE_ENROLMENT_CONFIRM") {
      return { committed: false };
    }

    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }

    const lockedFiling = await deps.filingRepo.lockById(tx, filing.id);
    if (lockedFiling.currentStep !== "ADVOCATE_ENROLMENT_CONFIRM") {
      return { committed: false };
    }

    await deps.filingRepo.clearEnrolmentCandidate(tx, lockedFiling.id);
    await deps.conversationRepo.setStateInTx(tx, locked.id, "ADVOCATE_ENROLMENT_PENDING");
    return { committed: true, sends: [{ messageType: "ADVOCATE_ENROLMENT_PROMPT" as const, dedupeSuffix: "enrolment-prompt" }] };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const delivered = await sendEnrolmentPrompt(deps.enrolmentSenderDeps, sendInputFor(input));
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

async function saveAndExit(deps: EnrolmentWorkflowDeps, input: EnrolmentActionInput): Promise<FilingWorkflowResult> {
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "ADVOCATE_ENROLMENT_CONFIRM") {
      return { committed: false };
    }
    // Part I: keep the candidate, the filing's current_step, and
    // active_filing_id exactly as-is — only the conversation moves.
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
  const savedDelivered = await sendFilingPlainText(deps.enrolmentSenderDeps, sendInput, SAVED_TEXT[input.language], "filing_saved_send_failed");
  await finalizeOutbound(deps, commit.outboundIds[0], savedDelivered);

  const menuDelivered = await sendMainMenu(deps.mainMenuSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[1], menuDelivered);

  return { delivered: savedDelivered && menuDelivered };
}
