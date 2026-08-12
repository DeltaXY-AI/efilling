import { parseDraftChoiceAction, parseFilingNoticeAction, type FilingSelectionInput } from "../domain/filing";
import type { ConversationRecord, ConversationRepository, ConversationState } from "../repositories/conversation-repository";
import type { FilingRepository } from "../repositories/filing-repository";
import type { OutboundMessageRepository, OutboundMessageType } from "../repositories/outbound-message-repository";
import type { RepositoryTransaction } from "../repositories/transaction";
import type { SendOutcome } from "../types/messaging-client";
import { sendDraftChoice, sendFilingNotice, sendFilingPlainText, type FilingSenderDeps } from "./filing-sender";
import { sendMainMenu, type MainMenuSenderDeps, type SupportedLanguage } from "./main-menu-sender";

export interface FilingWorkflowDeps {
  conversationRepo: ConversationRepository;
  filingRepo: FilingRepository;
  /** Durable outbound intent, enqueued inside the same transaction as each committed state change — see commitWithOutbound below. */
  outboundMessageRepo: OutboundMessageRepository;
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

type WriteOutcome =
  | { committed: false }
  | { committed: true; messageType: OutboundMessageType; dedupeSuffix: string };

interface CommitResult {
  committed: boolean;
  outboundId: string | null;
}

/**
 * Locks the conversation, runs `writeInTx` (which performs the domain
 * write(s) and decides what outbound message, if any, they imply), and —
 * only if it committed — enqueues a durable outbound record for that
 * intent inside the SAME transaction, before it commits. This is what
 * makes a committed state change reconcilable even if the process crashes
 * or the send fails anywhere after this function returns: the row exists
 * and is queryable as `pending` regardless of what happens next. `dedupeKey`
 * (`${messageId}:${dedupeSuffix}`) makes enqueuing idempotent — if it
 * somehow raced (it shouldn't, since the webhook route's MessageSid claim
 * already guarantees this exact call only happens once), the second
 * attempt is treated the same as `stale`: no second send.
 */
async function commitWithOutbound(
  deps: FilingWorkflowDeps,
  input: { conversationId: string; messageId: string; language: SupportedLanguage },
  writeInTx: (tx: RepositoryTransaction, locked: ConversationRecord) => Promise<WriteOutcome>,
): Promise<CommitResult> {
  let result: CommitResult = { committed: false, outboundId: null };

  await deps.withTransaction(async (tx) => {
    const locked = await deps.conversationRepo.lockById(tx, input.conversationId);
    const outcome = await writeInTx(tx, locked);
    if (!outcome.committed) {
      result = { committed: false, outboundId: null };
      return;
    }

    const enqueued = await deps.outboundMessageRepo.enqueue(tx, {
      dedupeKey: `${input.messageId}:${outcome.dedupeSuffix}`,
      conversationId: input.conversationId,
      messageType: outcome.messageType,
      language: input.language,
    });
    result = enqueued ? { committed: true, outboundId: enqueued.id } : { committed: false, outboundId: null };
  });

  return result;
}

/**
 * Dispatches the send and records its outcome on the enqueued outbound row
 * — never leaves it stuck at "pending". Recording `providerMessageId` on a
 * successful send is what makes that row reconcilable against a later
 * delivery-status webhook (#16 task 7) — see kapso-webhook.route.ts's
 * status-event handling and OutboundMessageRepository.recordDeliveryStatus.
 */
async function finalizeOutbound(deps: FilingWorkflowDeps, outboundId: string, outcome: SendOutcome): Promise<void> {
  if (outcome.delivered) {
    await deps.outboundMessageRepo.markSent(outboundId, outcome.providerMessageId);
  } else {
    await deps.outboundMessageRepo.markFailed(outboundId, "send_failed");
  }
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
      return { committed: true, messageType: "FILING_DRAFT_CHOICE", dedupeSuffix: "draft-choice" };
    }

    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_NOTICE");
    sendKind = "notice";
    return { committed: true, messageType: "FILING_NOTICE", dedupeSuffix: "filing-notice" };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const sendInput = sendInputFor(input);
  const outcome =
    sendKind === "draft-choice"
      ? await sendDraftChoice(deps.filingSenderDeps, sendInput)
      : await sendFilingNotice(deps.filingSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundId as string, outcome);
  return { delivered: outcome.delivered };
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
    const outcome = await sendDraftChoice(deps.filingSenderDeps, sendInput);
    return { delivered: outcome.delivered };
  }

  if (action === "nav:main-menu") {
    const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
      if (locked.state !== "FILING_DRAFT_CHOICE") {
        return { committed: false };
      }
      await deps.conversationRepo.setStateInTx(tx, locked.id, "MAIN_MENU");
      return { committed: true, messageType: "MAIN_MENU", dedupeSuffix: "main-menu" };
    });
    if (!commit.committed) {
      return { delivered: true };
    }
    const outcome = await sendMainMenu(deps.mainMenuSenderDeps, sendInput);
    await finalizeOutbound(deps, commit.outboundId as string, outcome);
    return { delivered: outcome.delivered };
  }

  if (action === "filing:start-new") {
    const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
      if (locked.state !== "FILING_DRAFT_CHOICE") {
        return { committed: false };
      }
      await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_NOTICE");
      return { committed: true, messageType: "FILING_NOTICE", dedupeSuffix: "filing-notice" };
    });
    if (!commit.committed) {
      return { delivered: true };
    }
    const outcome = await sendFilingNotice(deps.filingSenderDeps, sendInput);
    await finalizeOutbound(deps, commit.outboundId as string, outcome);
    return { delivered: outcome.delivered };
  }

  // filing:resume-draft
  return resumeDraft(deps, input);
}

async function resumeDraft(deps: FilingWorkflowDeps, input: FilingActionInput): Promise<FilingWorkflowResult> {
  let kind: "resumed" | "unsupported-step" | "no-draft" | null = null;

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
      return { committed: true, messageType: "FILING_NOTICE", dedupeSuffix: "filing-notice-redirect" };
    }

    if (!SUPPORTED_FILING_STEPS.has(draft.currentStep)) {
      // Do not guess or modify the filing (Part G) — nothing is committed,
      // so no outbound record is needed for this no-op.
      kind = "unsupported-step";
      return { committed: false };
    }

    await deps.conversationRepo.setStateInTx(tx, locked.id, draft.currentStep as ConversationState);
    kind = "resumed";
    return { committed: true, messageType: "FILING_RESUMED", dedupeSuffix: "resumed" };
  });

  const sendInput = sendInputFor(input);

  if (kind === "unsupported-step") {
    const outcome = await sendFilingPlainText(
      deps.filingSenderDeps,
      sendInput,
      UNSUPPORTED_STEP_TEXT[input.language],
      "filing_resume_unsupported_step",
    );
    return { delivered: outcome.delivered };
  }

  if (!commit.committed) {
    // Stale: state was no longer FILING_DRAFT_CHOICE by the time the lock
    // was granted (a concurrent action already moved it) — no-op.
    return { delivered: true };
  }

  if (kind === "no-draft") {
    const outcome = await sendFilingNotice(deps.filingSenderDeps, sendInput);
    await finalizeOutbound(deps, commit.outboundId as string, outcome);
    return { delivered: outcome.delivered };
  }

  const outcome = await sendFilingPlainText(deps.filingSenderDeps, sendInput, RESUMED_TEXT[input.language], "filing_resume_confirmation_send_failed");
  await finalizeOutbound(deps, commit.outboundId as string, outcome);
  return { delivered: outcome.delivered };
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
    const outcome = await sendFilingNotice(deps.filingSenderDeps, sendInput);
    return { delivered: outcome.delivered };
  }

  if (action === "nav:main-menu") {
    const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
      if (locked.state !== "FILING_NOTICE") {
        return { committed: false };
      }
      await deps.conversationRepo.setStateInTx(tx, locked.id, "MAIN_MENU");
      return { committed: true, messageType: "MAIN_MENU", dedupeSuffix: "main-menu" };
    });
    if (!commit.committed) {
      return { delivered: true };
    }
    const outcome = await sendMainMenu(deps.mainMenuSenderDeps, sendInput);
    await finalizeOutbound(deps, commit.outboundId as string, outcome);
    return { delivered: outcome.delivered };
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
    return { committed: true, messageType: "FILING_DRAFT_CREATED", dedupeSuffix: "draft-created" };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const outcome = await sendFilingPlainText(
    deps.filingSenderDeps,
    sendInput,
    COMPLETION_TEXT[input.language],
    "filing_draft_created_confirmation_send_failed",
  );
  await finalizeOutbound(deps, commit.outboundId as string, outcome);
  return { delivered: outcome.delivered };
}
