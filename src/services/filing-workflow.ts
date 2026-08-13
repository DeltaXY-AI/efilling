import { parseDraftChoiceAction, parseFilingNoticeAction, type FilingSelectionInput } from "../domain/filing";
import type { ConversationState, ConversationRepository } from "../repositories/conversation-repository";
import type { FilingPartyRepository } from "../repositories/filing-party-repository";
import type { FilingRecord, FilingRepository } from "../repositories/filing-repository";
import type { OutboundMessageRepository } from "../repositories/outbound-message-repository";
import type { RepositoryTransaction } from "../repositories/transaction";
import type { AccusedSenderDeps } from "./accused-sender";
import { ACCUSED_SUPPORTED_FILING_STEPS, resendAccusedPromptForResume } from "./accused-workflow";
import type { ComplainantSenderDeps } from "./complainant-sender";
import { COMPLAINANT_SUPPORTED_FILING_STEPS, resendComplainantPromptForResume } from "./complainant-workflow";
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
  /** Reused as-is for "back to main menu" — never a second menu-sending implementation. */
  mainMenuSenderDeps: MainMenuSenderDeps;
  /** Reused as-is for the enrolment prompt sent right after a draft is created (#9) and when resuming into it — never a second implementation. */
  enrolmentSenderDeps: EnrolmentSenderDeps;
  /** Reused as-is for resuming into any of #10's complainant-details steps — never a second implementation. */
  complainantSenderDeps: ComplainantSenderDeps;
  /** Reused as-is for resuming into any of #11's accused-details steps — never a second implementation. */
  accusedSenderDeps: AccusedSenderDeps;
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

/** Only ever set by this issue's own createDraft, #9's saveEnrolmentCandidate, #10's complainant-details steps, or #11's accused-details steps — real, deployed, resumable steps. */
const SUPPORTED_FILING_STEPS: ReadonlySet<string> = new Set([
  "ADVOCATE_ENROLMENT_PENDING",
  "ADVOCATE_ENROLMENT_CONFIRM",
  ...COMPLAINANT_SUPPORTED_FILING_STEPS,
  ...ACCUSED_SUPPORTED_FILING_STEPS,
]);

const RESUMED_TEXT: Record<SupportedLanguage, string> = {
  en: "Your saved filing has been resumed.",
  ml: "നിങ്ങളുടെ സേവ് ചെയ്ത ഫയലിംഗ് പുനരാരംഭിച്ചു.",
};

/** Sent when a draft's current_step isn't one this deployment knows how to resume — the draft itself is left untouched. */
const UNSUPPORTED_STEP_TEXT: Record<SupportedLanguage, string> = {
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

/**
 * Handles `menu:file-case` from MAIN_MENU (Part F). Locks the conversation,
 * checks for an active draft via the authoritative `active_filing_id`
 * pointer, and atomically transitions to FILING_DRAFT_CHOICE or
 * FILING_NOTICE. A stale re-delivery (conversation no longer MAIN_MENU by
 * the time the lock is granted — e.g. a concurrent duplicate tap already
 * moved it) is a safe no-op: the first valid transition already won.
 */
export async function handleFileOrResume(deps: FilingWorkflowDeps, input: FileOrResumeInput): Promise<FilingWorkflowResult> {
  let sendKind: "draft-choice" | "notice" | null = null;

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

    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_NOTICE");
    sendKind = "notice";
    return { committed: true, sends: [{ messageType: "FILING_NOTICE" as const, dedupeSuffix: "filing-notice" }] };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const sendInput = sendInputFor(input);
  const delivered =
    sendKind === "draft-choice"
      ? await sendDraftChoice(deps.filingSenderDeps, sendInput)
      : await sendFilingNotice(deps.filingSenderDeps, sendInput);
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
    const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
      if (locked.state !== "FILING_DRAFT_CHOICE") {
        return { committed: false };
      }
      await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_NOTICE");
      return { committed: true, sends: [{ messageType: "FILING_NOTICE" as const, dedupeSuffix: "filing-notice" }] };
    });
    if (!commit.committed) {
      return { delivered: true };
    }
    const delivered = await sendFilingNotice(deps.filingSenderDeps, sendInput);
    await finalizeOutbound(deps, commit.outboundIds[0], delivered);
    return { delivered };
  }

  // filing:resume-draft
  return resumeDraft(deps, input);
}

async function resumeDraft(deps: FilingWorkflowDeps, input: FilingActionInput): Promise<FilingWorkflowResult> {
  let kind: "resumed" | "unsupported-step" | "no-draft" | null = null;
  let resumedStep: string | null = null;
  let resumedNormalizedEnrolment: string | null = null;
  // Captured so #10's resendComplainantPromptForResume can look up the
  // party by filing id without a second findActiveDraft read after commit.
  let resumedFiling: FilingRecord | null = null;

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

    if (!SUPPORTED_FILING_STEPS.has(draft.currentStep)) {
      // Do not guess or modify the filing (Part G) — nothing is committed,
      // so no outbound record is needed for this no-op.
      kind = "unsupported-step";
      return { committed: false };
    }

    // #10/#11 Part A: neither COMPLAINANT_DETAILS_START nor
    // ACCUSED_DETAILS_START is ever persisted going forward (see
    // schema.ts) — any pre-existing row still at either value resumes as
    // its effective *_NAME_PENDING equivalent. Both the filing's
    // current_step and the conversation's state are corrected together
    // here (Part B: "must move together in the same transaction") rather
    // than leaving current_step stale until the next valid answer.
    const LEGACY_DETAILS_START_TO_NAME_PENDING: Partial<Record<string, ConversationState>> = {
      COMPLAINANT_DETAILS_START: "COMPLAINANT_NAME_PENDING",
      ACCUSED_DETAILS_START: "ACCUSED_NAME_PENDING",
    };
    const legacyTranslation = LEGACY_DETAILS_START_TO_NAME_PENDING[draft.currentStep];
    const isLegacyDetailsStart = legacyTranslation !== undefined;
    const resumeState: ConversationState = legacyTranslation ?? (draft.currentStep as ConversationState);
    if (isLegacyDetailsStart) {
      await deps.filingRepo.setCurrentStep(tx, draft.id, resumeState);
    }
    await deps.conversationRepo.setStateInTx(tx, locked.id, resumeState);
    kind = "resumed";
    resumedStep = resumeState;
    resumedNormalizedEnrolment = draft.advocateEnrolmentNormalized;
    resumedFiling = isLegacyDetailsStart ? { ...draft, currentStep: resumeState } : draft;
    const dedupeSuffix = draft.currentStep === "ADVOCATE_ENROLMENT_CONFIRM" ? "resumed-enrolment-confirm" : "resumed";
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

  // kind === "resumed". #9 Part I: resuming into ADVOCATE_ENROLMENT_CONFIRM
  // must resend the confirmation template with the saved candidate, not the
  // generic resumed text — the advocate needs to see the number again to
  // act on Confirm/Edit/Save and exit. #10/#11: resuming into any of the
  // complainant- or accused-details steps must likewise resend the exact
  // pending field prompt or the review screen, not the generic resumed text.
  let delivered: boolean;
  if (resumedStep === "ADVOCATE_ENROLMENT_CONFIRM" && resumedNormalizedEnrolment) {
    delivered = await sendEnrolmentConfirmation(deps.enrolmentSenderDeps, sendInput, resumedNormalizedEnrolment);
  } else if (resumedStep && resumedFiling && COMPLAINANT_SUPPORTED_FILING_STEPS.has(resumedStep)) {
    delivered = await resendComplainantPromptForResume(
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
  } else if (resumedStep && resumedFiling && ACCUSED_SUPPORTED_FILING_STEPS.has(resumedStep)) {
    delivered = await resendAccusedPromptForResume(
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
  } else {
    delivered = await sendFilingPlainText(deps.filingSenderDeps, sendInput, RESUMED_TEXT[input.language], "filing_resume_confirmation_send_failed");
  }
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
