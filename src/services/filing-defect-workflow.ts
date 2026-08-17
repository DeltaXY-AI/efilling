import { validateChequeNumber } from "../domain/filing-details";
import { parseFilingDocumentAction } from "../domain/filing-document";
import {
  parseDefectAlertAction,
  parseDefectReviewAction,
  parseDefectSentAction,
  parseDelayDaysSelection,
  validateDelayReason,
  type DefectSelectionInput,
} from "../domain/filing-defect";
import type { TwilioMessagingClient } from "../adapters/twilio/messaging-client";
import type { ConversationRepository } from "../repositories/conversation-repository";
import type { FilingDocumentRepository } from "../repositories/filing-document-repository";
import type { FilingPartyRepository } from "../repositories/filing-party-repository";
import type { FilingRecord, FilingRepository } from "../repositories/filing-repository";
import type { OutboundMessageRepository } from "../repositories/outbound-message-repository";
import type { RepositoryTransaction } from "../repositories/transaction";
import {
  sendDefect1Invalid,
  sendDefect1Prompt,
  sendDefect2Prompt,
  sendDefect3ReasonInvalid,
  sendDefect3ReasonPrompt,
  sendDefectAlertAndList,
  sendDefectReviewActions,
  sendDefectReviewSummary,
  sendDefectSent,
  sendDefectSentActions,
  sendDelayDaysPrompt,
  type FilingDefectSenderDeps,
  type SendFilingDefectMessageInput,
} from "./filing-defect-sender";
import { sendFilingPlainText } from "./filing-sender";
import { storeFilingDocument, type FilingDocumentStorageDeps } from "./filing-document-storage";
import { sendMainMenu, type MainMenuSenderDeps, type SupportedLanguage } from "./main-menu-sender";
import { commitWithOutbound, finalizeOutbound } from "./transactional-outbound";
import type { InboundMedia } from "../types/inbound-message";
import type { FilingWorkflowResult } from "./filing-workflow";

/**
 * Implements #37 (Prototype parity — Phase 9): the scrutiny-defect
 * correction flow — FILING_DEFECT_ALERT (entered from
 * filing-draft-list-workflow.ts's "Simulate scrutiny defects" action)
 * through FILING_DEFECT_1/2/3 and FILING_DEFECT_REVIEW to FILING_DEFECT_SENT.
 *
 * This file must never import from filing-draft-list-workflow.ts —
 * filing-draft-list-workflow.ts imports the leaf send functions from
 * filing-defect-sender.ts directly to perform the FILING_DRAFT_DETAIL ->
 * FILING_DEFECT_ALERT cascade itself, the same one-way-dependency pattern
 * every earlier phase boundary in this codebase already follows (e.g.
 * filing-review-workflow.ts -> filing-sign-sender.ts).
 *
 * Defect 3's two sub-questions (reason for delay, then days of delay) share
 * one persisted state, FILING_DEFECT_3 — Part A's DefectState union has no
 * separate state for each. Which sub-question is currently open is read
 * directly off the filing's own persisted `defectDelayReason` (null = still
 * awaiting the reason; set = awaiting the days), never a second, unpersisted
 * flag — the same durable-state discipline this codebase uses everywhere
 * else, so a conversation genuinely resumes correctly after any gap.
 *
 * Defect 2's re-upload reuses filing_documents with document_group "cheque"
 * (Part B) — but min/max (1/2) is checked only against documents uploaded
 * *since* defectNotifiedAt, not the group's lifetime count, since the
 * original Phase 3 upload already used up to 2 "cheque" documents. Counting
 * the whole group here would make a fresh re-upload impossible.
 */

export interface FilingDefectWorkflowDeps {
  conversationRepo: ConversationRepository;
  filingRepo: FilingRepository;
  /** Read-only here — only used to render the complainant/accused names on the defect alert and its redisplay. */
  partyRepo: FilingPartyRepository;
  filingDocumentRepo: FilingDocumentRepository;
  /** Durable outbound intent, enqueued inside the same transaction as each committed state change — see commitWithOutbound in transactional-outbound.ts. */
  outboundMessageRepo: OutboundMessageRepository;
  messagingClient: TwilioMessagingClient;
  fromNumber: string;
  /** Downloads Defect 2's re-uploaded photo from Twilio and re-uploads it to durable storage — same adapter #31's document uploads use. */
  documentStorageDeps: FilingDocumentStorageDeps;
  filingDefectSenderDeps: FilingDefectSenderDeps;
  /** Reused as-is for FILING_DEFECT_SENT's "Main menu" action — never a second implementation. */
  mainMenuSenderDeps: MainMenuSenderDeps;
  withTransaction: <T>(fn: (tx: RepositoryTransaction) => Promise<T>) => Promise<T>;
}

export interface FilingDefectActionInput {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
  selection: DefectSelectionInput;
}

export interface FilingDefectFieldInputEvent {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
  text: string;
  mediaCount: number;
}

export interface FilingDefectDocumentInputEvent {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
  text: string;
  buttonPayload?: string;
  buttonText?: string;
  media: InboundMedia[];
}

function sendInputFor(input: { whatsappNumber: string; language: SupportedLanguage; messageId: string }): SendFilingDefectMessageInput {
  return { to: input.whatsappNumber, language: input.language, correlationId: input.messageId };
}

/** Read-only: resolves the conversation's filing regardless of status (mirrors filing-completion-workflow.ts's currentActiveFiling) — the filing here is always FILED, never re-checked here since every commit below re-verifies inside its own transaction. */
async function currentDefectFiling(deps: FilingDefectWorkflowDeps, conversationId: string): Promise<FilingRecord | null> {
  return deps.withTransaction((tx) => deps.filingRepo.findByActiveFilingId(tx, conversationId));
}

/** Redisplays the defect alert + fixed defect list + "Correct the defects" action for an already-fetched filing — never re-derives it from the current webhook body. */
async function redisplayDefectAlert(deps: FilingDefectWorkflowDeps, sendInput: SendFilingDefectMessageInput, filing: FilingRecord): Promise<boolean> {
  const complainant = await deps.withTransaction((tx) => deps.partyRepo.findByFilingAndRole(tx, filing.id, "COMPLAINANT"));
  const accused = await deps.withTransaction((tx) => deps.partyRepo.findByFilingAndRole(tx, filing.id, "ACCUSED"));
  return sendDefectAlertAndList(deps.filingDefectSenderDeps, sendInput, filing, complainant?.fullName ?? null, accused?.fullName ?? null);
}

// ---------------------------------------------------------------------------
// FILING_DEFECT_ALERT dispatch: the one action, "Correct the defects".
// ---------------------------------------------------------------------------

export async function handleFilingDefectAlertInput(deps: FilingDefectWorkflowDeps, input: FilingDefectActionInput): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);
  const action = parseDefectAlertAction(input.selection);

  if (!action) {
    const filing = await currentDefectFiling(deps, input.conversationId);
    if (!filing) {
      return { delivered: true };
    }
    return { delivered: await redisplayDefectAlert(deps, sendInput, filing) };
  }

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_DEFECT_ALERT") {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findByActiveFilingId(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    await deps.filingRepo.setCurrentStep(tx, filing.id, "FILING_DEFECT_1");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_DEFECT_1");
    return { committed: true, sends: [{ messageType: "FILING_DEFECT_1_PROMPT" as const, dedupeSuffix: "filing-defect-1-prompt" }] };
  });

  if (!commit.committed) {
    return { delivered: true };
  }
  const delivered = await sendDefect1Prompt(deps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

// ---------------------------------------------------------------------------
// FILING_DEFECT_1: cheque-number correction.
// ---------------------------------------------------------------------------

export async function handleFilingDefect1Input(deps: FilingDefectWorkflowDeps, input: FilingDefectFieldInputEvent): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);

  if (input.mediaCount > 0 && !input.text.trim()) {
    return { delivered: await sendDefect1Invalid(deps, sendInput) };
  }
  const validation = validateChequeNumber(input.text);
  if (!validation.valid || !validation.normalized) {
    return { delivered: await sendDefect1Invalid(deps, sendInput) };
  }

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_DEFECT_1") {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findByActiveFilingId(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    await deps.filingRepo.upsertFilingFields(tx, filing.id, { defectCorrectedChequeNumber: validation.normalized });
    await deps.filingRepo.setCurrentStep(tx, filing.id, "FILING_DEFECT_2");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_DEFECT_2");
    return { committed: true, sends: [{ messageType: "FILING_DEFECT_2_PROMPT" as const, dedupeSuffix: "filing-defect-2-prompt" }] };
  });

  if (!commit.committed) {
    return { delivered: true };
  }
  const delivered = await sendDefect2Prompt(deps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

// ---------------------------------------------------------------------------
// FILING_DEFECT_2: cheque-photo re-upload (min 1, max 2 — counted only
// against documents added since defectNotifiedAt, see file header).
// ---------------------------------------------------------------------------

const DEFECT_2_MIN = 1;
const DEFECT_2_MAX = 2;

const DEFECT_2_UNRECOGNIZED_TEXT: Record<SupportedLanguage, string> = {
  en: 'Please send the cheque photo, or reply "done" once you\'ve sent enough.',
  ml: 'ചെക്ക് ഫോട്ടോ അയക്കുക, അല്ലെങ്കിൽ ആവശ്യത്തിന് അയച്ചു കഴിഞ്ഞാൽ "കഴിഞ്ഞു" എന്ന് മറുപടി നൽകുക.',
};

const DEFECT_2_MIN_NOT_MET_TEXT: Record<SupportedLanguage, string> = {
  en: "Please send at least 1 photo before continuing.",
  ml: "തുടരുന്നതിന് മുൻപ് കുറഞ്ഞത് 1 ഫോട്ടോ അയക്കുക.",
};

const DEFECT_2_MAX_REACHED_TEXT: Record<SupportedLanguage, string> = {
  en: `Got it — that's the maximum (${DEFECT_2_MAX}) for this re-upload. Reply "done" to continue.`,
  ml: `ലഭിച്ചു — ഇത് ഈ പുനർ അപ്‌ലോഡിനുള്ള പരമാവധി (${DEFECT_2_MAX}) ആണ്. തുടരാൻ "കഴിഞ്ഞു" എന്ന് മറുപടി നൽകുക.`,
};

function defect2ReceivedText(language: SupportedLanguage, count: number): string {
  if (count >= DEFECT_2_MAX) {
    return DEFECT_2_MAX_REACHED_TEXT[language];
  }
  return language === "ml"
    ? `ലഭിച്ചു — ${DEFECT_2_MAX}-ൽ ${count} എണ്ണം ലഭിച്ചു. ഇനിയൊന്ന് അയക്കുക, അല്ലെങ്കിൽ പൂർത്തിയായാൽ "കഴിഞ്ഞു" എന്ന് മറുപടി നൽകുക.`
    : `Got it — ${count} of ${DEFECT_2_MAX} received. Send another, or reply "done" when finished.`;
}

/**
 * Documents added to the "cheque" group since the defect alert was raised —
 * never the group's lifetime count (see file header). Uses `>=`, not `>`:
 * defectNotifiedAt is always set (and the advocate is only ever prompted to
 * re-upload) strictly before any re-upload can happen, but clock resolution
 * is coarse enough on some platforms that two `new Date()` calls a few
 * statements apart can read back the same millisecond — `>=` never miscounts
 * a genuine re-upload as the (always chronologically earlier, real-world)
 * original Phase 3 upload.
 */
async function countDefectChequeUploads(deps: FilingDefectWorkflowDeps, tx: RepositoryTransaction, filing: FilingRecord): Promise<number> {
  if (!filing.defectNotifiedAt) {
    return 0;
  }
  const documents = await deps.filingDocumentRepo.listByFiling(tx, filing.id);
  return documents.filter((doc) => doc.documentGroup === "cheque" && doc.createdAt.getTime() >= filing.defectNotifiedAt!.getTime()).length;
}

async function handleDefect2Media(deps: FilingDefectWorkflowDeps, input: FilingDefectDocumentInputEvent): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);

  const conversation = await deps.conversationRepo.findByWhatsappNumber(input.whatsappNumber);
  if (!conversation || conversation.state !== "FILING_DEFECT_2") {
    return { delivered: true };
  }
  const filing = await deps.withTransaction((tx) => deps.filingRepo.findByActiveFilingId(tx, conversation.id));
  if (!filing) {
    return { delivered: true };
  }

  let ackText = "";
  for (const item of input.media) {
    const currentCount = await deps.withTransaction((tx) => countDefectChequeUploads(deps, tx, filing));
    if (currentCount >= DEFECT_2_MAX) {
      ackText = DEFECT_2_MAX_REACHED_TEXT[input.language];
      break;
    }

    const result = await storeFilingDocument(deps.documentStorageDeps, {
      mediaUrl: item.url,
      contentTypeHint: item.contentType,
      filingId: filing.id,
      documentGroup: "cheque",
    });
    if (!result.ok) {
      // Same unsupported/too-large/download-failed messages as #31's own
      // uploads would be overkill to duplicate for this one demo re-upload
      // screen — a generic "couldn't process" ack is enough here.
      ackText = input.language === "ml" ? "ആ ഫയൽ പ്രോസസ് ചെയ്യാൻ കഴിഞ്ഞില്ല. വീണ്ടും അയക്കാൻ ശ്രമിക്കുക." : "We couldn't process that file. Please try sending it again.";
      continue;
    }

    await deps.withTransaction((tx) =>
      deps.filingDocumentRepo.addDocument(tx, {
        filingId: filing.id,
        documentGroup: "cheque",
        storageUrl: result.storageUrl,
        contentType: result.contentType,
        originalTwilioMediaUrl: item.url,
      }),
    );
    ackText = defect2ReceivedText(input.language, currentCount + 1);
  }

  return { delivered: await sendFilingPlainText(deps, sendInput, ackText, "filing_defect_2_ack_send_failed") };
}

export async function handleFilingDefect2Input(deps: FilingDefectWorkflowDeps, input: FilingDefectDocumentInputEvent): Promise<FilingWorkflowResult> {
  if (input.media.length > 0) {
    return handleDefect2Media(deps, input);
  }

  const sendInput = sendInputFor(input);
  const action = parseFilingDocumentAction({ buttonPayload: input.buttonPayload, buttonText: input.buttonText, body: input.text });

  if (action !== "docs:continue") {
    return { delivered: await sendFilingPlainText(deps, sendInput, DEFECT_2_UNRECOGNIZED_TEXT[input.language], "filing_defect_2_unrecognized_send_failed") };
  }

  let sawFiling = false;
  let minMet = true;
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_DEFECT_2") {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findByActiveFilingId(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    sawFiling = true;

    const count = await countDefectChequeUploads(deps, tx, filing);
    if (count < DEFECT_2_MIN) {
      minMet = false;
      return { committed: false };
    }

    await deps.filingRepo.setCurrentStep(tx, filing.id, "FILING_DEFECT_3");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_DEFECT_3");
    return { committed: true, sends: [{ messageType: "FILING_DEFECT_3_REASON_PROMPT" as const, dedupeSuffix: "filing-defect-3-reason-prompt" }] };
  });

  if (!commit.committed) {
    if (sawFiling && !minMet) {
      return { delivered: await sendFilingPlainText(deps, sendInput, DEFECT_2_MIN_NOT_MET_TEXT[input.language], "filing_defect_2_min_not_met_send_failed") };
    }
    return { delivered: true };
  }
  const delivered = await sendDefect3ReasonPrompt(deps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

// ---------------------------------------------------------------------------
// FILING_DEFECT_3: reason for delay, then days of delay (one persisted
// state, distinguished by whether defectDelayReason is already set).
// ---------------------------------------------------------------------------

export async function handleFilingDefect3Input(deps: FilingDefectWorkflowDeps, input: FilingDefectActionInput): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);
  const filing = await currentDefectFiling(deps, input.conversationId);
  if (!filing) {
    return { delivered: true };
  }

  if (filing.defectDelayReason === null) {
    const validation = validateDelayReason(input.selection.body || "");
    if (!validation.valid || !validation.normalized) {
      return { delivered: await sendDefect3ReasonInvalid(deps, sendInput) };
    }

    const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
      if (locked.state !== "FILING_DEFECT_3") {
        return { committed: false };
      }
      const lockedFiling = await deps.filingRepo.findByActiveFilingId(tx, locked.id);
      if (!lockedFiling || lockedFiling.defectDelayReason !== null) {
        return { committed: false };
      }
      await deps.filingRepo.upsertFilingFields(tx, lockedFiling.id, { defectDelayReason: validation.normalized });
      return { committed: true, sends: [{ messageType: "FILING_DEFECT_3_DAYS_PROMPT" as const, dedupeSuffix: "filing-defect-3-days-prompt" }] };
    });

    if (!commit.committed) {
      return { delivered: true };
    }
    const delivered = await sendDelayDaysPrompt(deps.filingDefectSenderDeps, sendInput);
    await finalizeOutbound(deps, commit.outboundIds[0], delivered);
    return { delivered };
  }

  // defectDelayReason already set — this input answers the days-of-delay select.
  const days = parseDelayDaysSelection(input.selection);
  if (days === null) {
    return { delivered: await sendDelayDaysPrompt(deps.filingDefectSenderDeps, sendInput) };
  }

  let reviewFiling: FilingRecord | null = null;
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_DEFECT_3") {
      return { committed: false };
    }
    const lockedFiling = await deps.filingRepo.findByActiveFilingId(tx, locked.id);
    if (!lockedFiling || lockedFiling.defectDelayReason === null) {
      return { committed: false };
    }
    await deps.filingRepo.upsertFilingFields(tx, lockedFiling.id, { defectDelayDays: days });
    await deps.filingRepo.setCurrentStep(tx, lockedFiling.id, "FILING_DEFECT_REVIEW");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_DEFECT_REVIEW");
    reviewFiling = { ...lockedFiling, defectDelayDays: days, currentStep: "FILING_DEFECT_REVIEW" };
    return {
      committed: true,
      sends: [
        { messageType: "FILING_DEFECT_REVIEW_SUMMARY" as const, dedupeSuffix: "filing-defect-review-summary" },
        { messageType: "FILING_DEFECT_REVIEW_ACTIONS" as const, dedupeSuffix: "filing-defect-review-actions" },
      ],
    };
  });

  if (!commit.committed || !reviewFiling) {
    return { delivered: true };
  }
  const summaryDelivered = await sendDefectReviewSummary(deps, sendInput, reviewFiling);
  await finalizeOutbound(deps, commit.outboundIds[0], summaryDelivered);
  const actionsDelivered = await sendDefectReviewActions(deps.filingDefectSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[1], actionsDelivered);
  return { delivered: summaryDelivered && actionsDelivered };
}

// ---------------------------------------------------------------------------
// FILING_DEFECT_REVIEW dispatch: the one action — declare, pay ₹200
// (simulated — no real payment gateway, matching Phase 7's discipline), and
// resubmit, all in this single tap (Part A has no separate declare state).
// ---------------------------------------------------------------------------

export async function handleFilingDefectReviewInput(deps: FilingDefectWorkflowDeps, input: FilingDefectActionInput): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);
  const action = parseDefectReviewAction(input.selection);

  if (!action) {
    const filing = await currentDefectFiling(deps, input.conversationId);
    if (!filing) {
      return { delivered: true };
    }
    const summaryDelivered = await sendDefectReviewSummary(deps, sendInput, filing);
    const actionsDelivered = await sendDefectReviewActions(deps.filingDefectSenderDeps, sendInput);
    return { delivered: summaryDelivered && actionsDelivered };
  }

  // filing:defect-confirm
  let sentFiling: FilingRecord | null = null;
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_DEFECT_REVIEW") {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findByActiveFilingId(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    const resubmittedAt = new Date();
    await deps.filingRepo.upsertFilingFields(tx, filing.id, { defectResubmittedAt: resubmittedAt });
    await deps.filingRepo.setCurrentStep(tx, filing.id, "FILING_DEFECT_SENT");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_DEFECT_SENT");
    sentFiling = { ...filing, defectResubmittedAt: resubmittedAt, currentStep: "FILING_DEFECT_SENT" };
    return {
      committed: true,
      sends: [
        { messageType: "FILING_DEFECT_SENT_MESSAGE" as const, dedupeSuffix: "filing-defect-sent" },
        { messageType: "FILING_DEFECT_SENT_ACTIONS" as const, dedupeSuffix: "filing-defect-sent-actions" },
      ],
    };
  });

  if (!commit.committed || !sentFiling) {
    return { delivered: true };
  }
  const sentDelivered = await sendDefectSent(deps, sendInput, sentFiling);
  await finalizeOutbound(deps, commit.outboundIds[0], sentDelivered);
  const actionsDelivered = await sendDefectSentActions(deps.filingDefectSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[1], actionsDelivered);
  return { delivered: sentDelivered && actionsDelivered };
}

// ---------------------------------------------------------------------------
// FILING_DEFECT_SENT: the one action, back to the main menu.
// ---------------------------------------------------------------------------

export async function handleFilingDefectSentInput(deps: FilingDefectWorkflowDeps, input: FilingDefectActionInput): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);
  const action = parseDefectSentAction(input.selection);

  if (!action) {
    const filing = await currentDefectFiling(deps, input.conversationId);
    if (!filing) {
      return { delivered: true };
    }
    const sentDelivered = await sendDefectSent(deps, sendInput, filing);
    const actionsDelivered = await sendDefectSentActions(deps.filingDefectSenderDeps, sendInput);
    return { delivered: sentDelivered && actionsDelivered };
  }

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_DEFECT_SENT") {
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
