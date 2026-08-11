import { parseDraftChoiceAction, parseFilingNoticeAction, type FilingSelectionInput } from "../domain/filing";
import type { ConversationRepository, ConversationState } from "../repositories/conversation-repository";
import type { FilingRepository } from "../repositories/filing-repository";
import type { RepositoryTransaction } from "../repositories/transaction";
import { sendDraftChoice, sendFilingNotice, sendFilingPlainText, type FilingSenderDeps } from "./filing-sender";
import { sendMainMenu, type MainMenuSenderDeps, type SupportedLanguage } from "./main-menu-sender";

export interface FilingWorkflowDeps {
  conversationRepo: ConversationRepository;
  filingRepo: FilingRepository;
  filingSenderDeps: FilingSenderDeps;
  /** Reused as-is for "back to main menu" — never a second menu-sending implementation. */
  mainMenuSenderDeps: MainMenuSenderDeps;
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

/** Only ever set by this issue's own createDraft — a real, deployed, resumable step. */
const SUPPORTED_FILING_STEPS: ReadonlySet<string> = new Set(["ADVOCATE_ENROLMENT_PENDING"]);

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
  let outcome: "draft-choice" | "notice" | "stale" = "stale";

  await deps.withTransaction(async (tx) => {
    const locked = await deps.conversationRepo.lockById(tx, input.conversationId);
    if (locked.state !== "MAIN_MENU") {
      outcome = "stale";
      return;
    }

    const draft = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (draft) {
      await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_DRAFT_CHOICE");
      outcome = "draft-choice";
    } else {
      await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_NOTICE");
      outcome = "notice";
    }
  });

  if (outcome === "stale") {
    return { delivered: true };
  }

  const sendInput = sendInputFor(input);
  if (outcome === "draft-choice") {
    return { delivered: await sendDraftChoice(deps.filingSenderDeps, sendInput) };
  }
  return { delivered: await sendFilingNotice(deps.filingSenderDeps, sendInput) };
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
    const transitioned = await transitionIfState(deps, input.conversationId, "FILING_DRAFT_CHOICE", "MAIN_MENU");
    if (!transitioned) {
      return { delivered: true };
    }
    return { delivered: await sendMainMenu(deps.mainMenuSenderDeps, sendInput) };
  }

  if (action === "filing:start-new") {
    const transitioned = await transitionIfState(deps, input.conversationId, "FILING_DRAFT_CHOICE", "FILING_NOTICE");
    if (!transitioned) {
      return { delivered: true };
    }
    return { delivered: await sendFilingNotice(deps.filingSenderDeps, sendInput) };
  }

  // filing:resume-draft
  return resumeDraft(deps, input);
}

async function resumeDraft(deps: FilingWorkflowDeps, input: FilingActionInput): Promise<FilingWorkflowResult> {
  let outcome: "resumed" | "unsupported-step" | "no-draft" | "stale" = "stale";

  await deps.withTransaction(async (tx) => {
    const locked = await deps.conversationRepo.lockById(tx, input.conversationId);
    if (locked.state !== "FILING_DRAFT_CHOICE") {
      outcome = "stale";
      return;
    }

    const draft = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!draft) {
      // The draft disappeared after the choice was displayed — route
      // safely to FILING_NOTICE instead of a user-visible error (Part G).
      await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_NOTICE");
      outcome = "no-draft";
      return;
    }

    if (!SUPPORTED_FILING_STEPS.has(draft.currentStep)) {
      // Do not guess or modify the filing (Part G) — leave everything as-is.
      outcome = "unsupported-step";
      return;
    }

    await deps.conversationRepo.setStateInTx(tx, locked.id, draft.currentStep as ConversationState);
    outcome = "resumed";
  });

  const sendInput = sendInputFor(input);

  if (outcome === "stale") {
    return { delivered: true };
  }
  if (outcome === "no-draft") {
    return { delivered: await sendFilingNotice(deps.filingSenderDeps, sendInput) };
  }
  if (outcome === "unsupported-step") {
    return {
      delivered: await sendFilingPlainText(deps.filingSenderDeps, sendInput, UNSUPPORTED_STEP_TEXT[input.language], "filing_resume_unsupported_step"),
    };
  }
  return {
    delivered: await sendFilingPlainText(deps.filingSenderDeps, sendInput, RESUMED_TEXT[input.language], "filing_resume_confirmation_send_failed"),
  };
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
    const transitioned = await transitionIfState(deps, input.conversationId, "FILING_NOTICE", "MAIN_MENU");
    if (!transitioned) {
      return { delivered: true };
    }
    return { delivered: await sendMainMenu(deps.mainMenuSenderDeps, sendInput) };
  }

  // filing:accept-test-notice
  let created = false;
  await deps.withTransaction(async (tx) => {
    const locked = await deps.conversationRepo.lockById(tx, input.conversationId);
    if (locked.state !== "FILING_NOTICE") {
      return;
    }

    const filing = await deps.filingRepo.createDraft(tx, {
      conversationId: locked.id,
      language: input.language,
      role: "COMPLAINANT_ADVOCATE",
      testNoticeVersion: TEST_NOTICE_VERSION,
    });
    await deps.filingRepo.recordNoticeAcceptance(tx, filing.id, new Date());
    await deps.conversationRepo.setActiveFilingAndState(tx, locked.id, filing.id, "ADVOCATE_ENROLMENT_PENDING");
    created = true;
  });

  if (!created) {
    return { delivered: true };
  }
  return {
    delivered: await sendFilingPlainText(deps.filingSenderDeps, sendInput, COMPLETION_TEXT[input.language], "filing_draft_created_confirmation_send_failed"),
  };
}

/** Locks the conversation and transitions it only if it's still in `fromState` — returns whether the transition happened. */
async function transitionIfState(
  deps: FilingWorkflowDeps,
  conversationId: string,
  fromState: ConversationState,
  toState: ConversationState,
): Promise<boolean> {
  let transitioned = false;
  await deps.withTransaction(async (tx) => {
    const locked = await deps.conversationRepo.lockById(tx, conversationId);
    if (locked.state !== fromState) {
      return;
    }
    await deps.conversationRepo.setStateInTx(tx, locked.id, toState);
    transitioned = true;
  });
  return transitioned;
}
