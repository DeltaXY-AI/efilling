import { parseDraftChoiceAction, parseFilingNoticeAction, type FilingSelectionInput } from "../domain/filing";
import { sendCaseTypePrompt, type CaseTypeSenderDeps } from "./case-type-sender";
import type { BlobStorage } from "../adapters/blob-storage";
import type { ConversationState, ConversationRepository } from "../repositories/conversation-repository";
import type { FilingPartyRepository } from "../repositories/filing-party-repository";
import type { FilingRecord, FilingRepository } from "../repositories/filing-repository";
import type { OutboundMessageRepository } from "../repositories/outbound-message-repository";
import type { RepositoryTransaction } from "../repositories/transaction";
import type { AccusedSenderDeps } from "./accused-sender";
import { ACCUSED_SUPPORTED_FILING_STEPS, resendAccusedPromptForResume } from "./accused-workflow";
import type { ComplainantSenderDeps } from "./complainant-sender";
import { COMPLAINANT_SUPPORTED_FILING_STEPS, resendComplainantPromptForResume } from "./complainant-workflow";
import { FILING_DOCUMENT_SUPPORTED_STEPS, resendFilingDocumentPromptForResume } from "./filing-document-workflow";
import type { FilingDetailsSenderDeps } from "./filing-details-sender";
import { FILING_DETAILS_SUPPORTED_FILING_STEPS, resendFilingDetailsPromptForResume } from "./filing-details-workflow";
import { FILING_REVIEW_SUPPORTED_FILING_STEPS, resendFilingReviewPromptForResume } from "./filing-review-workflow";
import { FILING_SIGN_SUPPORTED_FILING_STEPS, recordFilingAsFiled, resendFilingSignPromptForResume } from "./filing-sign-workflow";
import type { FilingSignSenderDeps } from "./filing-sign-sender";
import { sendFiledActions, sendFiledSummary, type FilingCompletionSenderDeps } from "./filing-completion-sender";
import type { FilingDocumentRepository } from "../repositories/filing-document-repository";
import { sendEnrolmentConfirmation, sendEnrolmentPrompt, type EnrolmentSenderDeps } from "./enrolment-sender";
import { sendDraftChoice, sendFilingNotice, sendFilingPlainText, type FilingSenderDeps } from "./filing-sender";
import { sendMainMenu, type MainMenuSenderDeps, type SupportedLanguage } from "./main-menu-sender";
import { commitWithOutbound, finalizeOutbound } from "./transactional-outbound";

export interface FilingWorkflowDeps {
  conversationRepo: ConversationRepository;
  filingRepo: FilingRepository;
  /** #10's normalized party-details store — needed here only to resend the persisted summary when a draft resumes into COMPLAINANT_CONFIRM/ACCUSED_CONFIRM. */
  partyRepo: FilingPartyRepository;
  /** Durable outbound intent, enqueued inside the same transaction as each committed state change — see commitWithOutbound in transactional-outbound.ts. */
  outboundMessageRepo: OutboundMessageRepository;
  filingSenderDeps: FilingSenderDeps;
  /** Reused as-is for the case-type gate inserted before FILING_NOTICE — never a second implementation. */
  caseTypeSenderDeps: CaseTypeSenderDeps;
  /** Reused as-is for "back to main menu" — never a second menu-sending implementation. */
  mainMenuSenderDeps: MainMenuSenderDeps;
  /** Reused as-is for the enrolment prompt sent right after a draft is created (#9) and when resuming into it — never a second implementation. */
  enrolmentSenderDeps: EnrolmentSenderDeps;
  /** Reused as-is for resuming into any of #10's complainant-details steps — never a second implementation. */
  complainantSenderDeps: ComplainantSenderDeps;
  /** Reused as-is for resuming into any of #11's accused-details steps — never a second implementation. */
  accusedSenderDeps: AccusedSenderDeps;
  /** Reused as-is for resuming into any of #33 Parts C/D/F's steps — never a second implementation. */
  filingDetailsSenderDeps: FilingDetailsSenderDeps;
  /** #33 Part F's review needs this only to check whether Part E's optional written-account group has any files when resending the review on resume. */
  filingDocumentRepo: FilingDocumentRepository;
  /** Reused as-is for resuming into any of #34's draft-ready/OTP steps — never a second implementation. */
  filingSignSenderDeps: FilingSignSenderDeps;
  /** #35 — used only for the legacy FILING_FILED_START resume-translation below (a pre-existing row from #34 is actually filed on resume); never a second implementation of that copy. */
  filingCompletionSenderDeps: FilingCompletionSenderDeps;
  /** Only threaded through to build a resend's own FilingReviewWorkflowDeps below — a resumed FILING_REVIEW never itself regenerates the draft-complaint PDF. */
  blobStorage: BlobStorage;
  withTransaction: <T>(fn: (tx: RepositoryTransaction) => Promise<T>) => Promise<T>;
}

export interface FileOrResumeInput {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
}

export interface FilingActionInput {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
  selection: FilingSelectionInput;
}

export interface FilingWorkflowResult {
  delivered: boolean;
}

const TEST_NOTICE_VERSION = "v1";

/** Only ever set by this issue's own createDraft, #9's saveEnrolmentCandidate, #31's document-upload steps, #10's complainant-details steps, #11's accused-details steps, or #33's Parts C/D/F steps — real, deployed, resumable steps. */
const SUPPORTED_FILING_STEPS: ReadonlySet<string> = new Set([
  "ADVOCATE_ENROLMENT_PENDING",
  "ADVOCATE_ENROLMENT_CONFIRM",
  ...FILING_DOCUMENT_SUPPORTED_STEPS,
  ...COMPLAINANT_SUPPORTED_FILING_STEPS,
  ...ACCUSED_SUPPORTED_FILING_STEPS,
  ...FILING_DETAILS_SUPPORTED_FILING_STEPS,
  ...FILING_REVIEW_SUPPORTED_FILING_STEPS,
  ...FILING_SIGN_SUPPORTED_FILING_STEPS,
  // #35: FILING_FILED_START is a legacy-only sentinel from #34 (see
  // schema.ts) — a pre-existing row still at this value must still
  // resume, unlike FILING_FILED/FILING_DONE themselves, which (once a
  // filing is actually FILED) are never reachable through this
  // DRAFT-only findActiveDraft path in the first place.
  "FILING_FILED_START",
]);

const RESUMED_TEXT: Record<SupportedLanguage, string> = {
  en: "Your saved filing has been resumed.",
  ml: "നിങ്ങളുടെ സേവ് ചെയ്ത ഫയലിംഗ് പുനരാരംഭിച്ചു.",
};

/** Sent when a draft's current_step isn't one this deployment knows how to resume — the draft itself is left untouched. */
/** Exported for #36's per-draft resume (filing-draft-list-workflow.ts), which hits the exact same "unsupported step" case via applyResumeWrite. */
export const UNSUPPORTED_STEP_TEXT: Record<SupportedLanguage, string> = {
  en: "We couldn't resume this filing automatically. Our support team will follow up — your saved draft is unchanged.",
  ml: "ഈ ഫയലിംഗ് സ്വയമേവ പുനരാരംഭിക്കാൻ കഴിഞ്ഞില്ല. ഞങ്ങളുടെ സഹായ ടീം തുടർന്ന് ബന്ധപ്പെടും — നിങ്ങളുടെ സേവ് ചെയ്ത ഡ്രാഫ്റ്റിന് മാറ്റമില്ല.",
};

const COMPLETION_TEXT: Record<SupportedLanguage, string> = {
  en: "✓ Your filing draft is ready.\n\nNext, we will record your advocate enrolment details.",
  ml: "✓ നിങ്ങളുടെ ഫയലിംഗ് ഡ്രാഫ്റ്റ് തയ്യാറായി.\n\nഅടുത്തതായി അഭിഭാഷക എൻറോൾമെന്റ് വിവരങ്ങൾ രേഖപ്പെടുത്താം.",
};

function sendInputFor(input: { whatsappNumber: string; language: SupportedLanguage; messageId: string }) {
  return { to: input.whatsappNumber, language: input.language, correlationId: input.messageId };
}

type ResumeSendInput = ReturnType<typeof sendInputFor>;

// #10/#11 Part A: neither COMPLAINANT_DETAILS_START nor ACCUSED_DETAILS_START
// is ever persisted going forward (see schema.ts) — any pre-existing row
// still at either value resumes as its effective *_NAME_PENDING equivalent.
// #34: DRAFT_READY_START likewise resumes as FILING_DRAFT_READY. Both the
// filing's current_step and the conversation's state are corrected together
// (Part B: "must move together in the same transaction") rather than
// leaving current_step stale until the next valid answer.
const LEGACY_DETAILS_START_TO_NAME_PENDING: Partial<Record<string, ConversationState>> = {
  COMPLAINANT_DETAILS_START: "COMPLAINANT_NAME_PENDING",
  ACCUSED_DETAILS_START: "ACCUSED_NAME_PENDING",
  DRAFT_READY_START: "FILING_DRAFT_READY",
};

export interface ResumeFilingResult {
  kind: "resumed" | "unsupported-step";
  resumedStep?: string;
  resumedFiling?: FilingRecord;
  resumedNormalizedEnrolment?: string | null;
}

/**
 * Shared by resumeDraft (#8's single-draft "Resume draft" from
 * FILING_DRAFT_CHOICE) and #36's per-draft resume from FILING_DRAFT_LIST/
 * FILING_DRAFT_DETAIL — both must apply the exact same SUPPORTED_FILING_STEPS
 * gate, legacy-sentinel translation (including #35's FILING_FILED_START
 * special case, which actually files the draft rather than a pure rename),
 * and conversation active_filing_id/state write, never a second,
 * potentially-diverging implementation. Only performs the write — the
 * caller checks `kind` and, for "resumed", calls
 * resendPromptForResumedFiling afterward to actually deliver something.
 *
 * Always uses setActiveFilingAndState (not just setStateInTx), even though
 * #8's own single-draft resume never needs to actually change
 * active_filing_id (the draft being resumed is already the active one) —
 * #36's multi-draft resume genuinely does need to, so one shared write
 * covers both rather than two divergent ones.
 */
export async function applyResumeWrite(
  deps: FilingWorkflowDeps,
  tx: RepositoryTransaction,
  conversationId: string,
  draft: FilingRecord,
): Promise<ResumeFilingResult> {
  if (!SUPPORTED_FILING_STEPS.has(draft.currentStep)) {
    // Do not guess or modify the filing (Part G) — nothing is written here.
    return { kind: "unsupported-step" };
  }

  if (draft.currentStep === "FILING_FILED_START") {
    const filedFiling = await recordFilingAsFiled(deps.filingRepo, tx, draft);
    await deps.conversationRepo.setActiveFilingAndState(tx, conversationId, draft.id, "FILING_FILED");
    return { kind: "resumed", resumedStep: "FILING_FILED", resumedFiling: filedFiling };
  }

  const legacyTranslation = LEGACY_DETAILS_START_TO_NAME_PENDING[draft.currentStep];
  const isLegacyDetailsStart = legacyTranslation !== undefined;
  const resumeState: ConversationState = legacyTranslation ?? (draft.currentStep as ConversationState);
  if (isLegacyDetailsStart) {
    await deps.filingRepo.setCurrentStep(tx, draft.id, resumeState);
  }
  await deps.conversationRepo.setActiveFilingAndState(tx, conversationId, draft.id, resumeState);
  const resumedFiling = isLegacyDetailsStart ? { ...draft, currentStep: resumeState } : draft;
  return { kind: "resumed", resumedStep: resumeState, resumedFiling, resumedNormalizedEnrolment: draft.advocateEnrolmentNormalized };
}

/**
 * #9 Part I: resuming into ADVOCATE_ENROLMENT_CONFIRM must resend the
 * confirmation template with the saved candidate, not the generic resumed
 * text — the advocate needs to see the number again to act on
 * Confirm/Edit/Save and exit. #31: resuming into any of the 5
 * document-upload groups must likewise resend that group's own prompt.
 * #10/#11: resuming into any of the complainant- or accused-details steps
 * must likewise resend the exact pending field prompt or the review
 * screen, not the generic resumed text. Shared by resumeDraft and #36's
 * per-draft resume — see applyResumeWrite.
 */
export async function resendPromptForResumedFiling(
  deps: FilingWorkflowDeps,
  resumedStep: string,
  resumedFiling: FilingRecord | undefined,
  resumedNormalizedEnrolment: string | null | undefined,
  sendInput: ResumeSendInput,
): Promise<boolean> {
  if (resumedStep === "ADVOCATE_ENROLMENT_CONFIRM" && resumedNormalizedEnrolment) {
    return sendEnrolmentConfirmation(deps.enrolmentSenderDeps, sendInput, resumedNormalizedEnrolment);
  }
  if (FILING_DOCUMENT_SUPPORTED_STEPS.has(resumedStep)) {
    return resendFilingDocumentPromptForResume(deps.filingSenderDeps, resumedStep, sendInput);
  }
  if (resumedFiling && COMPLAINANT_SUPPORTED_FILING_STEPS.has(resumedStep)) {
    return resendComplainantPromptForResume(
      {
        conversationRepo: deps.conversationRepo,
        filingRepo: deps.filingRepo,
        partyRepo: deps.partyRepo,
        outboundMessageRepo: deps.outboundMessageRepo,
        complainantSenderDeps: deps.complainantSenderDeps,
        mainMenuSenderDeps: deps.mainMenuSenderDeps,
        accusedSenderDeps: deps.accusedSenderDeps,
        withTransaction: deps.withTransaction,
      },
      resumedFiling,
      sendInput,
    );
  }
  if (resumedFiling && ACCUSED_SUPPORTED_FILING_STEPS.has(resumedStep)) {
    return resendAccusedPromptForResume(
      {
        conversationRepo: deps.conversationRepo,
        filingRepo: deps.filingRepo,
        partyRepo: deps.partyRepo,
        outboundMessageRepo: deps.outboundMessageRepo,
        accusedSenderDeps: deps.accusedSenderDeps,
        mainMenuSenderDeps: deps.mainMenuSenderDeps,
        withTransaction: deps.withTransaction,
      },
      resumedFiling,
      sendInput,
    );
  }
  if (FILING_DETAILS_SUPPORTED_FILING_STEPS.has(resumedStep)) {
    return resendFilingDetailsPromptForResume(
      { filingDetailsSenderDeps: deps.filingDetailsSenderDeps, messagingClient: deps.filingSenderDeps.messagingClient, fromNumber: deps.filingSenderDeps.fromNumber },
      resumedStep,
      sendInput,
    );
  }
  if (resumedFiling && FILING_REVIEW_SUPPORTED_FILING_STEPS.has(resumedStep)) {
    return resendFilingReviewPromptForResume(
      {
        conversationRepo: deps.conversationRepo,
        filingRepo: deps.filingRepo,
        partyRepo: deps.partyRepo,
        filingDocumentRepo: deps.filingDocumentRepo,
        outboundMessageRepo: deps.outboundMessageRepo,
        filingDetailsSenderDeps: deps.filingDetailsSenderDeps,
        mainMenuSenderDeps: deps.mainMenuSenderDeps,
        filingSignSenderDeps: deps.filingSignSenderDeps,
        blobStorage: deps.blobStorage,
        withTransaction: deps.withTransaction,
      },
      resumedFiling,
      sendInput,
    );
  }
  if (resumedFiling && FILING_SIGN_SUPPORTED_FILING_STEPS.has(resumedStep)) {
    return resendFilingSignPromptForResume(
      { messagingClient: deps.filingSenderDeps.messagingClient, fromNumber: deps.filingSenderDeps.fromNumber, filingSignSenderDeps: deps.filingSignSenderDeps },
      resumedFiling,
      sendInput,
    );
  }
  if (resumedStep === "FILING_FILED" && resumedFiling) {
    // #35: the legacy FILING_FILED_START branch above just filed this
    // draft for the first time — send the same filed-acknowledgement +
    // pay-fee actions the real cascade sends, not the generic resumed text.
    const summaryDelivered = await sendFiledSummary(deps.filingCompletionSenderDeps, sendInput, resumedFiling);
    const actionsDelivered = await sendFiledActions(deps.filingCompletionSenderDeps, sendInput);
    return summaryDelivered && actionsDelivered;
  }
  return sendFilingPlainText(deps.filingSenderDeps, sendInput, RESUMED_TEXT[sendInput.language], "filing_resume_confirmation_send_failed");
}

/**
 * Handles `menu:file-case` from MAIN_MENU (Part F). Locks the conversation,
 * checks for an active draft via the authoritative `active_filing_id`
 * pointer, and atomically transitions to FILING_DRAFT_CHOICE or
 * FILING_NOTICE. A stale re-delivery (conversation no longer MAIN_MENU by
 * the time the lock is granted — e.g. a concurrent duplicate tap already
 * moved it) is a safe no-op: the first valid transition already won.
 */
export async function handleFileOrResume(deps: FilingWorkflowDeps, input: FileOrResumeInput): Promise<FilingWorkflowResult> {
  let sendKind: "draft-choice" | "case-type" | null = null;

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "MAIN_MENU") {
      return { committed: false };
    }

    const draft = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (draft) {
      await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_DRAFT_CHOICE");
      sendKind = "draft-choice";
      return { committed: true, sends: [{ messageType: "FILING_DRAFT_CHOICE" as const, dedupeSuffix: "draft-choice" }] };
    }

    // A fresh filing starts at the case-type gate, not FILING_NOTICE
    // directly — only cheque-bounce is actually filed here (see
    // domain/case-type.ts).
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_CASE_TYPE_PENDING");
    sendKind = "case-type";
    return { committed: true, sends: [{ messageType: "FILING_CASE_TYPE_PROMPT" as const, dedupeSuffix: "case-type-prompt" }] };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const sendInput = sendInputFor(input);
  const delivered =
    sendKind === "draft-choice"
      ? await sendDraftChoice(deps.filingSenderDeps, sendInput)
      : await sendCaseTypePrompt(deps.caseTypeSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

/**
 * Handles input while at FILING_DRAFT_CHOICE (Part A/G): resume the active
 * draft, start a new filing (which only moves to FILING_NOTICE — Part H
 * says starting new must not immediately create a filing), or return to
 * the main menu. Unrecognized/stale input redisplays the draft-choice
 * template without changing state.
 */
export async function handleDraftChoiceInput(deps: FilingWorkflowDeps, input: FilingActionInput): Promise<FilingWorkflowResult> {
  const action = parseDraftChoiceAction(input.selection);
  const sendInput = sendInputFor(input);

  if (!action) {
    return { delivered: await sendDraftChoice(deps.filingSenderDeps, sendInput) };
  }

  if (action === "nav:main-menu") {
    const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
      if (locked.state !== "FILING_DRAFT_CHOICE") {
        return { committed: false };
      }
      await deps.conversationRepo.setStateInTx(tx, locked.id, "MAIN_MENU");
      return { committed: true, sends: [{ messageType: "MAIN_MENU" as const, dedupeSuffix: "main-menu" }] };
    });
    if (!commit.committed) {
      return { delivered: true };
    }
    const delivered = await sendMainMenu(deps.mainMenuSenderDeps, sendInput);
    await finalizeOutbound(deps, commit.outboundIds[0], delivered);
    return { delivered };
  }

  if (action === "filing:start-new") {
    // Same case-type gate as handleFileOrResume's no-draft branch — never a
    // second implementation of that choice.
    const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
      if (locked.state !== "FILING_DRAFT_CHOICE") {
        return { committed: false };
      }
      await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_CASE_TYPE_PENDING");
      return { committed: true, sends: [{ messageType: "FILING_CASE_TYPE_PROMPT" as const, dedupeSuffix: "case-type-prompt" }] };
    });
    if (!commit.committed) {
      return { delivered: true };
    }
    const delivered = await sendCaseTypePrompt(deps.caseTypeSenderDeps, sendInput);
    await finalizeOutbound(deps, commit.outboundIds[0], delivered);
    return { delivered };
  }

  // filing:resume-draft
  return resumeDraft(deps, input);
}

async function resumeDraft(deps: FilingWorkflowDeps, input: FilingActionInput): Promise<FilingWorkflowResult> {
  let kind: "resumed" | "unsupported-step" | "no-draft" | null = null;
  let resumeResult: ResumeFilingResult | null = null;

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_DRAFT_CHOICE") {
      return { committed: false };
    }

    const draft = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!draft) {
      // The draft disappeared after the choice was displayed — route
      // safely to FILING_NOTICE instead of a user-visible error (Part G).
      await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_NOTICE");
      kind = "no-draft";
      return { committed: true, sends: [{ messageType: "FILING_NOTICE" as const, dedupeSuffix: "filing-notice-redirect" }] };
    }

    const result = await applyResumeWrite(deps, tx, locked.id, draft);
    if (result.kind === "unsupported-step") {
      kind = "unsupported-step";
      return { committed: false };
    }

    kind = "resumed";
    resumeResult = result;
    const dedupeSuffix =
      draft.currentStep === "ADVOCATE_ENROLMENT_CONFIRM"
        ? "resumed-enrolment-confirm"
        : draft.currentStep === "FILING_FILED_START"
          ? "resumed-filed"
          : "resumed";
    return { committed: true, sends: [{ messageType: "FILING_RESUMED" as const, dedupeSuffix }] };
  });

  const sendInput = sendInputFor(input);

  if (kind === "unsupported-step") {
    return {
      delivered: await sendFilingPlainText(deps.filingSenderDeps, sendInput, UNSUPPORTED_STEP_TEXT[input.language], "filing_resume_unsupported_step"),
    };
  }

  if (!commit.committed) {
    // Stale: state was no longer FILING_DRAFT_CHOICE by the time the lock
    // was granted (a concurrent action already moved it) — no-op.
    return { delivered: true };
  }

  if (kind === "no-draft") {
    const delivered = await sendFilingNotice(deps.filingSenderDeps, sendInput);
    await finalizeOutbound(deps, commit.outboundIds[0], delivered);
    return { delivered };
  }

  // kind === "resumed"
  const delivered = await resendPromptForResumedFiling(
    deps,
    resumeResult!.resumedStep!,
    resumeResult!.resumedFiling,
    resumeResult!.resumedNormalizedEnrolment,
    sendInput,
  );
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

/**
 * Handles input while at FILING_NOTICE (Part H): accepting the notice
 * creates exactly one new draft and moves to ADVOCATE_ENROLMENT_PENDING in
 * a single transaction; returning to the main menu creates nothing.
 * Unrecognized/stale input redisplays the notice without changing state.
 */
export async function handleFilingNoticeInput(deps: FilingWorkflowDeps, input: FilingActionInput): Promise<FilingWorkflowResult> {
  const action = parseFilingNoticeAction(input.selection);
  const sendInput = sendInputFor(input);

  if (!action) {
    return { delivered: await sendFilingNotice(deps.filingSenderDeps, sendInput) };
  }

  if (action === "nav:main-menu") {
    const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
      if (locked.state !== "FILING_NOTICE") {
        return { committed: false };
      }
      await deps.conversationRepo.setStateInTx(tx, locked.id, "MAIN_MENU");
      return { committed: true, sends: [{ messageType: "MAIN_MENU" as const, dedupeSuffix: "main-menu" }] };
    });
    if (!commit.committed) {
      return { delivered: true };
    }
    const delivered = await sendMainMenu(deps.mainMenuSenderDeps, sendInput);
    await finalizeOutbound(deps, commit.outboundIds[0], delivered);
    return { delivered };
  }

  // filing:accept-test-notice
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_NOTICE") {
      return { committed: false };
    }

    const filing = await deps.filingRepo.createDraft(tx, {
      conversationId: locked.id,
      language: input.language,
      role: "COMPLAINANT_ADVOCATE",
      testNoticeVersion: TEST_NOTICE_VERSION,
    });
    await deps.filingRepo.recordNoticeAcceptance(tx, filing.id, new Date());
    await deps.conversationRepo.setActiveFilingAndState(tx, locked.id, filing.id, "ADVOCATE_ENROLMENT_PENDING");
    return {
      committed: true,
      sends: [
        { messageType: "FILING_DRAFT_CREATED" as const, dedupeSuffix: "draft-created" },
        // #9 Part D/acceptance criteria: entering ADVOCATE_ENROLMENT_PENDING
        // must send the enrolment prompt, tracked durably in the same
        // outbox/transaction as the draft creation it follows.
        { messageType: "ADVOCATE_ENROLMENT_PROMPT" as const, dedupeSuffix: "enrolment-prompt" },
      ],
    };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const completionDelivered = await sendFilingPlainText(
    deps.filingSenderDeps,
    sendInput,
    COMPLETION_TEXT[input.language],
    "filing_draft_created_confirmation_send_failed",
  );
  await finalizeOutbound(deps, commit.outboundIds[0], completionDelivered);

  const promptDelivered = await sendEnrolmentPrompt(deps.enrolmentSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[1], promptDelivered);

  return { delivered: completionDelivered && promptDelivered };
}
