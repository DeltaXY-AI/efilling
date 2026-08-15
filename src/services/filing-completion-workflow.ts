import { randomUUID } from "node:crypto";
import { parseFilingFiledAction, type FilingCompletionSelectionInput } from "../domain/filing-completion";
import type { TwilioMessagingClient } from "../adapters/twilio/messaging-client";
import type { ConversationRepository } from "../repositories/conversation-repository";
import type { FilingRecord, FilingRepository } from "../repositories/filing-repository";
import type { OutboundMessageRepository } from "../repositories/outbound-message-repository";
import type { RepositoryTransaction } from "../repositories/transaction";
import {
  sendFeePaidMessage,
  sendFiledActions,
  sendFiledSummary,
  sendFilingDoneMessage,
  type FilingCompletionSenderDeps,
  type SendFilingCompletionMessageInput,
} from "./filing-completion-sender";
import { sendMainMenu, type MainMenuSenderDeps, type SupportedLanguage } from "./main-menu-sender";
import { commitWithOutbound, finalizeOutbound } from "./transactional-outbound";
import type { FilingWorkflowResult } from "./filing-workflow";

/**
 * Implements #35 (Prototype parity — Phase 7): the filed acknowledgement,
 * the simulated court-fee payment, and the final completion message — the
 * new, reachable end of the Complainant Advocate "file a case" journey.
 *
 * Once a filing reaches FILING_FILED, its status is no longer DRAFT (see
 * filing-sign-workflow.ts's recordFilingAsFiled / filingRepo.recordFiled),
 * so findActiveDraft naturally stops surfacing it as an active draft to
 * resume — every filing lookup in this file uses findByActiveFilingId
 * instead, which resolves the same conversations.active_filing_id pointer
 * without that DRAFT-only filter.
 *
 * This file must never import from filing-workflow.ts — filing-workflow.ts
 * imports from every phase's own workflow module, so the dependency only
 * ever runs one way.
 */

export interface FilingCompletionWorkflowDeps {
  conversationRepo: ConversationRepository;
  filingRepo: FilingRepository;
  /** Durable outbound intent, enqueued inside the same transaction as each committed state change — see commitWithOutbound in transactional-outbound.ts. */
  outboundMessageRepo: OutboundMessageRepository;
  messagingClient: TwilioMessagingClient;
  fromNumber: string;
  filingCompletionSenderDeps: FilingCompletionSenderDeps;
  /** Reused as-is for the final "any input -> main menu" transition — never a second implementation. */
  mainMenuSenderDeps: MainMenuSenderDeps;
  withTransaction: <T>(fn: (tx: RepositoryTransaction) => Promise<T>) => Promise<T>;
}

export interface FilingFiledActionInput {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
  selection: FilingCompletionSelectionInput;
}

export interface FilingDoneInputEvent {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
}

function sendInputFor(input: { whatsappNumber: string; language: SupportedLanguage; messageId: string }): SendFilingCompletionMessageInput {
  return { to: input.whatsappNumber, language: input.language, correlationId: input.messageId };
}

// Part B / Scope decision: no real payment gateway is ever called — this is
// a simulated "paid" state flip. "SIM-" + a full UUID is unambiguously a
// demo artifact (real gateways never return a bare UUID as a transaction
// reference), so it can never be mistaken for a genuine payment record.
function generateSimulatedTransactionId(): string {
  return `SIM-${randomUUID().toUpperCase()}`;
}

async function sendFiledSummaryAndActions(deps: FilingCompletionWorkflowDeps, sendInput: SendFilingCompletionMessageInput, filing: FilingRecord): Promise<boolean> {
  const summaryDelivered = await sendFiledSummary(deps, sendInput, filing);
  const actionsDelivered = await sendFiledActions(deps.filingCompletionSenderDeps, sendInput);
  return summaryDelivered && actionsDelivered;
}

// ---------------------------------------------------------------------------
// FILING_FILED: the one available action, paying the (simulated) court fee.
// ---------------------------------------------------------------------------

export async function handleFilingFiledInput(deps: FilingCompletionWorkflowDeps, input: FilingFiledActionInput): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);
  const action = parseFilingFiledAction(input.selection);

  if (!action) {
    const filing = await deps.withTransaction((tx) => deps.filingRepo.findByActiveFilingId(tx, input.conversationId));
    if (!filing) {
      // Nothing to redisplay (data integrity edge case) — safe no-op.
      return { delivered: true };
    }
    return { delivered: await sendFiledSummaryAndActions(deps, sendInput, filing) };
  }

  // filing:pay-fee
  let paidFiling: FilingRecord | null = null;
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_FILED") {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findByActiveFilingId(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    const transactionId = generateSimulatedTransactionId();
    const paidAt = new Date();
    await deps.filingRepo.recordFeePaid(tx, filing.id, { transactionId, paidAt });
    // Paying the fee is documented as automatic/same-turn (Part A) — never
    // left resting at a persisted FILING_FEE_PAID; the conversation moves
    // straight to FILING_DONE in this same transaction.
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_DONE");
    paidFiling = { ...filing, courtFeePaidAt: paidAt, courtFeeTransactionId: transactionId, currentStep: "FILING_DONE" };
    return {
      committed: true,
      sends: [
        { messageType: "FILING_FEE_PAID_MESSAGE" as const, dedupeSuffix: "filing-fee-paid" },
        { messageType: "FILING_DONE_MESSAGE" as const, dedupeSuffix: "filing-done" },
      ],
    };
  });

  if (!commit.committed || !paidFiling) {
    return { delivered: true };
  }

  const paidDelivered = await sendFeePaidMessage(deps, sendInput, paidFiling);
  await finalizeOutbound(deps, commit.outboundIds[0], paidDelivered);
  const doneDelivered = await sendFilingDoneMessage(deps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[1], doneDelivered);
  return { delivered: paidDelivered && doneDelivered };
}

// ---------------------------------------------------------------------------
// FILING_DONE: any input at all moves on to MAIN_MENU (Part A) — no action
// parsing, no redisplay of the completion message on "unrecognized" input.
// ---------------------------------------------------------------------------

export async function handleFilingDoneInput(deps: FilingCompletionWorkflowDeps, input: FilingDoneInputEvent): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_DONE") {
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
