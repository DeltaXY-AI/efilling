import { parseDraftDetailAction, parseDraftListSelection, type DraftListSelectionInput } from "../domain/filing-draft-list";
import type { FilingDocumentGroup } from "../domain/filing-document";
import type { BlobStorage } from "../adapters/blob-storage";
import type { TwilioMessagingClient } from "../adapters/twilio/messaging-client";
import { logWorkflowError } from "../lib/logger";
import type { ConversationRepository } from "../repositories/conversation-repository";
import type { FilingDocumentRepository } from "../repositories/filing-document-repository";
import type { FilingPartyRepository } from "../repositories/filing-party-repository";
import type { FilingRecord, FilingRepository } from "../repositories/filing-repository";
import type { OutboundMessageRepository } from "../repositories/outbound-message-repository";
import type { RepositoryTransaction } from "../repositories/transaction";
import {
  buildDraftListRows,
  documentsComplete,
  sendCaseStatus,
  sendDiscarded,
  sendDraftCardMessage,
  sendDraftListMessage,
  type DraftListRow,
  type FilingDraftListSenderDeps,
  type SendFilingDraftListMessageInput,
} from "./filing-draft-list-sender";
import { applyResumeWrite, resendPromptForResumedFiling, UNSUPPORTED_STEP_TEXT, type FilingWorkflowDeps, type FilingWorkflowResult } from "./filing-workflow";
import { sendFilingPlainText } from "./filing-sender";
import { sendMainMenu, type MainMenuSenderDeps, type SupportedLanguage } from "./main-menu-sender";
import { commitWithOutbound, finalizeOutbound } from "./transactional-outbound";

/**
 * Implements #36 (Prototype parity — Phase 8): "My cases" — a sectioned
 * list of every filing for this conversation (Drafts / Active cases,
 * newest first), the per-draft detail card, and per-draft resume/discard.
 *
 * Resuming a specific draft reuses filing-workflow.ts's applyResumeWrite/
 * resendPromptForResumedFiling — the exact same SUPPORTED_FILING_STEPS
 * gate, legacy-sentinel translation, and per-phase resend dispatch as #8's
 * own single-draft "Resume draft" from FILING_DRAFT_CHOICE, never a second,
 * potentially-diverging implementation. This file must never import from
 * filing-workflow.ts anything OTHER than those exports — the dependency
 * runs one way (filing-workflow.ts never imports from here).
 *
 * "Which draft is FILING_DRAFT_DETAIL currently showing" is tracked using
 * the existing conversations.active_filing_id pointer (#8) — never a new
 * column (Database changes: none, confirmed). Picking a list row sets
 * active_filing_id to it immediately (before Continue/Discard is tapped),
 * so the per-draft detail screen's static Continue/Discard/Main-menu
 * quick-reply (genuinely static content, like every other quick-reply in
 * this codebase — no per-request id variation) always resolves its target
 * from active_filing_id alone.
 *
 * The list itself is a Twilio List Picker Content Template, which must
 * keep a FIXED item structure to stay approvable — each of its 9 data
 * rows always has one of the 9 fixed positional ids
 * (filing:pick-row-1..9), never a filing's own id; only the visible
 * item/description TEXT is filled per send via content variables (see
 * filing-draft-list-sender.ts). A typed number means the same thing. The
 * workflow always resolves "position N" against the row order it just
 * (re)computed — the one source of truth for what's actually on screen.
 */
export interface FilingDraftListWorkflowDeps {
  conversationRepo: ConversationRepository;
  filingRepo: FilingRepository;
  partyRepo: FilingPartyRepository;
  filingDocumentRepo: FilingDocumentRepository;
  outboundMessageRepo: OutboundMessageRepository;
  messagingClient: TwilioMessagingClient;
  fromNumber: string;
  filingDraftListSenderDeps: FilingDraftListSenderDeps;
  /** Reused as-is for "Main menu" — never a second implementation. */
  mainMenuSenderDeps: MainMenuSenderDeps;
  /** #36 — deletes a discarded draft's uploaded files; the DB rows are deleted separately via filingDocumentRepo.deleteByFiling in the same transaction as abandonDraft. */
  blobStorage: BlobStorage;
  /** Reused as-is for per-draft resume (applyResumeWrite/resendPromptForResumedFiling) — never a second implementation of that dispatch. */
  filingWorkflowDeps: FilingWorkflowDeps;
  withTransaction: <T>(fn: (tx: RepositoryTransaction) => Promise<T>) => Promise<T>;
}

export interface FilingDraftListInput {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
  selection: DraftListSelectionInput;
}

function sendInputFor(input: { whatsappNumber: string; language: SupportedLanguage; messageId: string }): SendFilingDraftListMessageInput {
  return { to: input.whatsappNumber, language: input.language, correlationId: input.messageId };
}

async function buildRowsForConversation(
  deps: FilingDraftListWorkflowDeps,
  tx: RepositoryTransaction,
  language: SupportedLanguage,
  conversationId: string,
): Promise<{ rows: DraftListRow[]; overflowCount: number }> {
  const filings = await deps.filingRepo.listByConversation(tx, conversationId);
  const accusedNameByFilingId = new Map<string, string | null>();
  const docsCompleteByFilingId = new Map<string, boolean>();

  for (const filing of filings) {
    const accused = await deps.partyRepo.findByFilingAndRole(tx, filing.id, "ACCUSED");
    accusedNameByFilingId.set(filing.id, accused?.fullName ?? null);

    if (filing.status === "DRAFT") {
      const documents = await deps.filingDocumentRepo.listByFiling(tx, filing.id);
      const counts: Partial<Record<FilingDocumentGroup, number>> = {};
      for (const document of documents) {
        counts[document.documentGroup] = (counts[document.documentGroup] ?? 0) + 1;
      }
      docsCompleteByFilingId.set(filing.id, documentsComplete(counts));
    }
  }

  return buildDraftListRows(language, filings, accusedNameByFilingId, docsCompleteByFilingId);
}

/** Read-only: builds and sends the current list without touching any state. Callers that DO need a state write commit separately first. */
async function sendFreshDraftList(deps: FilingDraftListWorkflowDeps, input: FilingDraftListInput): Promise<boolean> {
  const { rows, overflowCount } = await deps.withTransaction((tx) => buildRowsForConversation(deps, tx, input.language, input.conversationId));
  return sendDraftListMessage(deps.filingDraftListSenderDeps, sendInputFor(input), rows, overflowCount);
}

/** Forces the conversation back to FILING_DRAFT_LIST and resends it — used both for entry from MAIN_MENU and for any stale/invalid input recovery (Part B: "must redisplay the current, accurate list rather than erroring"). */
async function redisplayDraftList(deps: FilingDraftListWorkflowDeps, input: FilingDraftListInput): Promise<FilingWorkflowResult> {
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_DRAFT_LIST");
    return { committed: true, sends: [{ messageType: "FILING_DRAFT_LIST_MESSAGE" as const, dedupeSuffix: "draft-list" }] };
  });
  if (!commit.committed) {
    return { delivered: true };
  }
  const delivered = await sendFreshDraftList(deps, input);
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

/** Handles `menu:my-cases` from MAIN_MENU — the entry point into this whole screen. */
export async function handleMyCasesEntry(deps: FilingDraftListWorkflowDeps, input: FilingDraftListInput): Promise<FilingWorkflowResult> {
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "MAIN_MENU") {
      return { committed: false };
    }
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_DRAFT_LIST");
    return { committed: true, sends: [{ messageType: "FILING_DRAFT_LIST_MESSAGE" as const, dedupeSuffix: "draft-list-entry" }] };
  });
  if (!commit.committed) {
    return { delivered: true };
  }
  const delivered = await sendFreshDraftList(deps, input);
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

async function goToMainMenu(deps: FilingDraftListWorkflowDeps, input: FilingDraftListInput, fromState: "FILING_DRAFT_LIST" | "FILING_DRAFT_DETAIL"): Promise<FilingWorkflowResult> {
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== fromState) {
      return { committed: false };
    }
    await deps.conversationRepo.setStateInTx(tx, locked.id, "MAIN_MENU");
    return { committed: true, sends: [{ messageType: "MAIN_MENU" as const, dedupeSuffix: "main-menu" }] };
  });
  if (!commit.committed) {
    return { delivered: true };
  }
  const delivered = await sendMainMenu(deps.mainMenuSenderDeps, sendInputFor(input));
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

// ---------------------------------------------------------------------------
// FILING_DRAFT_LIST
// ---------------------------------------------------------------------------

async function pickDraftRow(deps: FilingDraftListWorkflowDeps, input: FilingDraftListInput, filingId: string): Promise<FilingWorkflowResult> {
  let picked: FilingRecord | null = null;

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_DRAFT_LIST") {
      return { committed: false };
    }
    let filing: FilingRecord;
    try {
      filing = await deps.filingRepo.lockById(tx, filingId);
    } catch {
      return { committed: false };
    }
    if (filing.conversationId !== locked.id || filing.status !== "DRAFT") {
      // Stale: already discarded/filed elsewhere, or not even this
      // conversation's own filing — never guess, redisplay instead.
      return { committed: false };
    }
    await deps.conversationRepo.setActiveFilingAndState(tx, locked.id, filing.id, "FILING_DRAFT_DETAIL");
    picked = filing;
    return { committed: true, sends: [{ messageType: "FILING_DRAFT_DETAIL_MESSAGE" as const, dedupeSuffix: `draft-detail-${filing.id}` }] };
  });

  if (!commit.committed || !picked) {
    return redisplayDraftList(deps, input);
  }

  const documents = await deps.withTransaction((tx) => deps.filingDocumentRepo.listByFiling(tx, picked!.id));
  const counts: Partial<Record<FilingDocumentGroup, number>> = {};
  for (const document of documents) {
    counts[document.documentGroup] = (counts[document.documentGroup] ?? 0) + 1;
  }
  const accused = await deps.withTransaction((tx) => deps.partyRepo.findByFilingAndRole(tx, picked!.id, "ACCUSED"));
  const delivered = await sendDraftCardMessage(
    deps.filingDraftListSenderDeps,
    sendInputFor(input),
    picked,
    accused?.fullName ?? null,
    documentsComplete(counts),
    new Date(),
  );
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

async function pickCaseRow(deps: FilingDraftListWorkflowDeps, input: FilingDraftListInput, filingId: string): Promise<FilingWorkflowResult> {
  // Read-only (Part B/acceptance criteria: "no edit actions") — conversation
  // state never changes, so no commit/outbox tracking is needed here.
  const conversation = await deps.conversationRepo.findByWhatsappNumber(input.whatsappNumber);
  if (!conversation || conversation.state !== "FILING_DRAFT_LIST") {
    return { delivered: true };
  }
  const filing = await deps.withTransaction((tx) => deps.filingRepo.listByConversation(tx, conversation.id)).then((filings) => filings.find((f) => f.id === filingId) ?? null);
  if (!filing || filing.status !== "FILED") {
    return redisplayDraftList(deps, input);
  }
  const accused = await deps.withTransaction((tx) => deps.partyRepo.findByFilingAndRole(tx, filing.id, "ACCUSED"));
  const statusDelivered = await sendCaseStatus(deps, sendInputFor(input), filing, accused?.fullName ?? null);
  const listDelivered = await sendFreshDraftList(deps, input);
  return { delivered: statusDelivered && listDelivered };
}

export async function handleFilingDraftListInput(deps: FilingDraftListWorkflowDeps, input: FilingDraftListInput): Promise<FilingWorkflowResult> {
  const selection = parseDraftListSelection(input.selection);

  if (!selection) {
    return redisplayDraftList(deps, input);
  }
  if (selection.kind === "nav-main-menu") {
    return goToMainMenu(deps, input, "FILING_DRAFT_LIST");
  }

  // selection.kind === "position" — resolved against the row order the
  // list was actually built with, the one source of truth for what's on
  // screen right now (never a re-derivation the advocate can't see).
  const { rows } = await deps.withTransaction((tx) => buildRowsForConversation(deps, tx, input.language, input.conversationId));
  const row = rows[selection.position - 1];
  if (!row) {
    return redisplayDraftList(deps, input);
  }
  return row.rowKind === "draft" ? pickDraftRow(deps, input, row.filingId) : pickCaseRow(deps, input, row.filingId);
}

// ---------------------------------------------------------------------------
// FILING_DRAFT_DETAIL
// ---------------------------------------------------------------------------

async function resumeFromDetail(deps: FilingDraftListWorkflowDeps, input: FilingDraftListInput): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);
  // A plain object (rather than two bare `let`s) so TypeScript re-checks
  // its property types fresh after the `await` below, instead of
  // incorrectly narrowing a captured closure variable to whichever branch
  // it last saw assigned.
  const captured: { outcome: "resumed" | "unsupported-step" | "stale"; resumed: Awaited<ReturnType<typeof applyResumeWrite>> | null } = {
    outcome: "stale",
    resumed: null,
  };

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_DRAFT_DETAIL" || !locked.activeFilingId) {
      return { committed: false };
    }
    let draft: FilingRecord;
    try {
      draft = await deps.filingRepo.lockById(tx, locked.activeFilingId);
    } catch {
      return { committed: false };
    }
    if (draft.status !== "DRAFT") {
      return { committed: false };
    }
    const result = await applyResumeWrite(deps.filingWorkflowDeps, tx, locked.id, draft);
    if (result.kind === "unsupported-step") {
      captured.outcome = "unsupported-step";
      return { committed: false };
    }
    captured.outcome = "resumed";
    captured.resumed = result;
    return { committed: true, sends: [{ messageType: "FILING_RESUMED" as const, dedupeSuffix: "resumed-from-my-cases" }] };
  });

  if (captured.outcome === "unsupported-step") {
    return {
      delivered: await sendFilingPlainText(deps.filingWorkflowDeps.filingSenderDeps, sendInput, UNSUPPORTED_STEP_TEXT[input.language], "filing_resume_unsupported_step"),
    };
  }
  if (!commit.committed || !captured.resumed) {
    // Stale: the draft being viewed was discarded/changed elsewhere —
    // never guess, redisplay the (now-accurate) list instead.
    return redisplayDraftList(deps, input);
  }

  const delivered = await resendPromptForResumedFiling(
    deps.filingWorkflowDeps,
    captured.resumed.resumedStep!,
    captured.resumed.resumedFiling,
    captured.resumed.resumedNormalizedEnrolment,
    sendInput,
  );
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

async function discardFromDetail(deps: FilingDraftListWorkflowDeps, input: FilingDraftListInput): Promise<FilingWorkflowResult> {
  const conversation = await deps.conversationRepo.findByWhatsappNumber(input.whatsappNumber);
  if (!conversation || conversation.state !== "FILING_DRAFT_DETAIL" || !conversation.activeFilingId) {
    return redisplayDraftList(deps, input);
  }
  const targetFilingId = conversation.activeFilingId;

  const filing = await deps.withTransaction((tx) => deps.filingRepo.lockById(tx, targetFilingId)).catch(() => null);
  if (!filing || filing.status !== "DRAFT") {
    return redisplayDraftList(deps, input);
  }

  // Scope decision (confirmed): discard actually deletes the uploaded
  // documents, not just the DB flag. Blob deletion is I/O outside the DB
  // transaction (not rollback-able) — a failure here is logged, never
  // fatal, matching this codebase's send/finalize convention; the DB
  // write below is still the authoritative, user-visible commitment.
  const documents = await deps.withTransaction((tx) => deps.filingDocumentRepo.listByFiling(tx, targetFilingId));
  try {
    await deps.blobStorage.delete(documents.map((document) => document.storageUrl));
  } catch {
    logWorkflowError({ code: "filing_draft_discard_blob_delete_failed", correlationId: input.messageId });
  }

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_DRAFT_DETAIL" || locked.activeFilingId !== targetFilingId) {
      return { committed: false };
    }
    await deps.filingDocumentRepo.deleteByFiling(tx, targetFilingId);
    await deps.filingRepo.abandonDraft(tx, targetFilingId);
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_DRAFT_LIST");
    return {
      committed: true,
      sends: [
        { messageType: "FILING_DRAFT_DISCARDED_MESSAGE" as const, dedupeSuffix: "discarded" },
        { messageType: "FILING_DRAFT_LIST_MESSAGE" as const, dedupeSuffix: "draft-list-after-discard" },
      ],
    };
  });

  if (!commit.committed) {
    return redisplayDraftList(deps, input);
  }

  const discardedDelivered = await sendDiscarded(deps.filingDraftListSenderDeps, sendInputFor(input));
  await finalizeOutbound(deps, commit.outboundIds[0], discardedDelivered);
  const listDelivered = await sendFreshDraftList(deps, input);
  await finalizeOutbound(deps, commit.outboundIds[1], listDelivered);
  return { delivered: discardedDelivered && listDelivered };
}

export async function handleFilingDraftDetailInput(deps: FilingDraftListWorkflowDeps, input: FilingDraftListInput): Promise<FilingWorkflowResult> {
  const action = parseDraftDetailAction(input.selection);

  if (!action) {
    // Unrecognized — redisplay the same draft card the advocate is
    // already looking at (resolved via active_filing_id), never the list.
    const conversation = await deps.conversationRepo.findByWhatsappNumber(input.whatsappNumber);
    if (!conversation?.activeFilingId) {
      return redisplayDraftList(deps, input);
    }
    const filing = await deps.withTransaction((tx) => deps.filingRepo.lockById(tx, conversation.activeFilingId as string)).catch(() => null);
    if (!filing || filing.status !== "DRAFT") {
      return redisplayDraftList(deps, input);
    }
    const documents = await deps.withTransaction((tx) => deps.filingDocumentRepo.listByFiling(tx, filing.id));
    const counts: Partial<Record<FilingDocumentGroup, number>> = {};
    for (const document of documents) {
      counts[document.documentGroup] = (counts[document.documentGroup] ?? 0) + 1;
    }
    const accused = await deps.withTransaction((tx) => deps.partyRepo.findByFilingAndRole(tx, filing.id, "ACCUSED"));
    return {
      delivered: await sendDraftCardMessage(deps.filingDraftListSenderDeps, sendInputFor(input), filing, accused?.fullName ?? null, documentsComplete(counts), new Date()),
    };
  }

  if (action === "nav:main-menu") {
    return goToMainMenu(deps, input, "FILING_DRAFT_DETAIL");
  }
  if (action === "filing:resume-draft") {
    return resumeFromDetail(deps, input);
  }
  return discardFromDetail(deps, input);
}
