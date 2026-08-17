import { randomUUID } from "node:crypto";
import { parseFilingFiledAction, type FilingCompletionSelectionInput } from "../domain/filing-completion";
import type { TwilioMessagingClient } from "../adapters/twilio/messaging-client";
import type { BlobStorage } from "../adapters/blob-storage";
import type { ConversationRepository } from "../repositories/conversation-repository";
import type { FilingPartyRepository } from "../repositories/filing-party-repository";
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
import { feeReceiptPdfFilename, renderFeeReceiptPdf } from "./fee-receipt-pdf";
import { logWorkflowError } from "../lib/logger";
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
  /** Only used to fetch the complainant's name/address for the fee-receipt PDF — never touched by anything else in this file. */
  partyRepo: FilingPartyRepository;
  /** Durable outbound intent, enqueued inside the same transaction as each committed state change — see commitWithOutbound in transactional-outbound.ts. */
  outboundMessageRepo: OutboundMessageRepository;
  messagingClient: TwilioMessagingClient;
  fromNumber: string;
  filingCompletionSenderDeps: FilingCompletionSenderDeps;
  /** Reused as-is for the final "any input -> main menu" transition — never a second implementation. */
  mainMenuSenderDeps: MainMenuSenderDeps;
  /** Used only to briefly host the generated fee-receipt PDF at a public URL for Twilio to fetch — uploaded, sent, then deleted around that one send (see fee-receipt-pdf.ts). */
  blobStorage: BlobStorage;
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

/**
 * Generates the fee-receipt PDF, hosts it briefly at a public Blob URL,
 * sends it, then deletes the blob again — best-effort throughout, mirroring
 * sendDraftComplaintPdfBestEffort in filing-review-workflow.ts exactly.
 * Any failure is logged and swallowed here; the caller never lets this
 * affect the result of the fee payment itself.
 */
async function sendFeeReceiptPdfBestEffort(deps: FilingCompletionWorkflowDeps, sendInput: SendFilingCompletionMessageInput, filing: FilingRecord, messageId: string): Promise<boolean> {
  try {
    const complainant = await deps.withTransaction((tx) => deps.partyRepo.findByFilingAndRole(tx, filing.id, "COMPLAINANT"));
    if (!complainant) {
      // Unreachable in practice — confirmed long before FILING_FILED — but never crash on it.
      logWorkflowError({ code: "filing_fee_receipt_pdf_missing_party_data", correlationId: messageId });
      return false;
    }

    const buffer = await renderFeeReceiptPdf(filing, complainant);
    const filename = feeReceiptPdfFilename(filing);
    const pathname = `filings/${filing.id}/generated/${randomUUID()}-${filename}`;
    const { url } = await deps.blobStorage.storePublic({ pathname, buffer, contentType: "application/pdf" });

    try {
      await deps.messagingClient.sendMediaMessage({ from: deps.fromNumber, to: sendInput.to, mediaUrl: url });
      return true;
    } finally {
      await deps.blobStorage.delete([url]).catch(() => undefined);
    }
  } catch {
    logWorkflowError({ code: "filing_fee_receipt_pdf_send_failed", correlationId: messageId });
    return false;
  }
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
        { messageType: "FILING_FEE_RECEIPT_PDF" as const, dedupeSuffix: "filing-fee-receipt-pdf" },
        { messageType: "FILING_DONE_MESSAGE" as const, dedupeSuffix: "filing-done" },
      ],
    };
  });

  if (!commit.committed || !paidFiling) {
    return { delivered: true };
  }

  const paidDelivered = await sendFeePaidMessage(deps, sendInput, paidFiling);
  await finalizeOutbound(deps, commit.outboundIds[0], paidDelivered);

  // Best-effort only (never affects the `delivered` result below) — same
  // rule as the draft-complaint PDF in filing-review-workflow.ts.
  const receiptDelivered = await sendFeeReceiptPdfBestEffort(deps, sendInput, paidFiling, input.messageId);
  await finalizeOutbound(deps, commit.outboundIds[1], receiptDelivered);

  const doneDelivered = await sendFilingDoneMessage(deps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[2], doneDelivered);
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
