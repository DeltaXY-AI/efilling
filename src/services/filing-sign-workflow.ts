import { isValidOtpFormat, parseDraftReadyAction, type FilingSignSelectionInput } from "../domain/filing-sign";
import type { TwilioMessagingClient } from "../adapters/twilio/messaging-client";
import type { ConversationRepository } from "../repositories/conversation-repository";
import type { FilingRecord, FilingRepository } from "../repositories/filing-repository";
import type { OutboundMessageRepository } from "../repositories/outbound-message-repository";
import type { RepositoryTransaction } from "../repositories/transaction";
import { sendFiledActions, sendFiledSummary, type FilingCompletionSenderDeps } from "./filing-completion-sender";
import { resendFilingReviewPromptForResume, type FilingReviewWorkflowDeps } from "./filing-review-workflow";
import { sendDraftReadyActions, sendDraftReadySummary, type FilingSignSenderDeps, type SendFilingSignMessageInput } from "./filing-sign-sender";
import { sendFilingPlainText } from "./filing-sender";
import type { SupportedLanguage } from "./main-menu-sender";
import { commitWithOutbound, finalizeOutbound } from "./transactional-outbound";
import type { FilingWorkflowResult } from "./filing-workflow";

/**
 * Implements #34 (Prototype parity — Phase 6): the draft-ready summary
 * (court + fee, court read from the filing's own persisted `selectedCourt`
 * — Phase 5 Part F — never hardcoded) and the simulated e-Sign (OTP) step.
 * The OTP check is a 6-digit format check only — no real Aadhaar/UIDAI
 * call is ever made, and the prompt copy is deliberately reworded from the
 * prototype's own wording to avoid implying a real Aadhaar-linked-mobile
 * OTP dispatch that doesn't exist in this codebase.
 *
 * This file must never import from filing-workflow.ts — filing-workflow.ts
 * imports `resendFilingSignPromptForResume` and `recordFilingAsFiled` from
 * here, so the dependency only ever runs one way. It imports
 * `resendFilingReviewPromptForResume` from filing-review-workflow.ts (to
 * send Phase 5's review screen back on "Edit details"), which must never
 * import back from here. It also imports the filed-summary sender
 * functions from filing-completion-sender.ts (a leaf module, #35) to
 * deliver the real FILING_FILED cascade once a valid OTP is entered.
 */

export interface FilingSignWorkflowDeps {
  conversationRepo: ConversationRepository;
  filingRepo: FilingRepository;
  /** Durable outbound intent, enqueued inside the same transaction as each committed state change — see commitWithOutbound in transactional-outbound.ts. */
  outboundMessageRepo: OutboundMessageRepository;
  messagingClient: TwilioMessagingClient;
  fromNumber: string;
  filingSignSenderDeps: FilingSignSenderDeps;
  /** Reused as-is for "Edit details" cascading back into Phase 5's review screen — never a second implementation. */
  filingReviewWorkflowDeps: FilingReviewWorkflowDeps;
  /** #35: used only to send the filed-acknowledgement summary + actions once a valid OTP cascades into FILING_FILED — never a second implementation of that copy. */
  filingCompletionSenderDeps: FilingCompletionSenderDeps;
  withTransaction: <T>(fn: (tx: RepositoryTransaction) => Promise<T>) => Promise<T>;
}

export interface FilingSignActionInput {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
  selection: FilingSignSelectionInput;
}

export interface FilingSignFieldInputEvent {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
  text: string;
  mediaCount: number;
}

function sendInputFor(input: { whatsappNumber: string; language: SupportedLanguage; messageId: string }): SendFilingSignMessageInput {
  return { to: input.whatsappNumber, language: input.language, correlationId: input.messageId };
}

/**
 * Last 4 digits of the advocate's own WhatsApp number — never a fabricated
 * Aadhaar-linked number (Part B). Masked the same way every other phone
 * number in this codebase is (see `maskSender` in `src/lib/logger.ts`):
 * only the last 4 digits are ever shown.
 */
function lastFourDigits(whatsappNumber: string): string {
  const digitsOnly = whatsappNumber.replace(/\D/g, "");
  return digitsOnly.slice(-4);
}

function otpPromptText(whatsappNumber: string, language: SupportedLanguage): string {
  const last4 = lastFourDigits(whatsappNumber);
  return language === "ml"
    ? [
        `🔒 നിങ്ങളുടെ നമ്പർ ${last4}-ൽ അവസാനിക്കുന്നതിലേക്ക് ഒരു OTP അയച്ചതായി കണക്കാക്കുക.`,
        "",
        "പരാതി ഇ-സൈൻ ചെയ്യാൻ 6 അക്ക OTP ഇവിടെ ടൈപ്പ് ചെയ്യുക.",
        "",
        "ഇത് ഈ പൈലറ്റിനുള്ള ഒരു സിമുലേറ്റഡ് ഘട്ടമാണ് — യഥാർത്ഥ OTP അയക്കുന്നില്ല, ആധാർ/UIDAI പരിശോധനയും ഇല്ല.",
      ].join("\n")
    : [
        `🔒 Treat this as an OTP sent to your number ending ${last4}.`,
        "",
        "Type the 6-digit OTP here to e-Sign the complaint.",
        "",
        "This is a simulated step for this pilot — no real OTP is sent, and there is no Aadhaar/UIDAI verification.",
      ].join("\n");
}

const OTP_BAD_TEXT: Record<SupportedLanguage, string> = {
  en: "That does not look like a 6-digit OTP. Please try again.",
  ml: "അത് 6 അക്ക OTP ആയി തോന്നുന്നില്ല. വീണ്ടും ശ്രമിക്കുക.",
};

/** Every currentStep #34 can resume into — combined with the other sets in filing-workflow.ts's SUPPORTED_FILING_STEPS. */
export const FILING_SIGN_SUPPORTED_FILING_STEPS: ReadonlySet<string> = new Set([
  // Legacy sentinel from #33's declare-accept — never persisted going
  // forward, kept only so a pre-existing row can still resume (translated
  // to FILING_DRAFT_READY in filing-workflow.ts's resumeDraft).
  "DRAFT_READY_START",
  "FILING_DRAFT_READY",
  "FILING_OTP_PENDING",
]);

interface DraftReadySendDeps {
  messagingClient: TwilioMessagingClient;
  fromNumber: string;
  filingSignSenderDeps: FilingSignSenderDeps;
}

/** Sends the draft-ready summary + its Review-and-eSign/Edit-details actions from an already-fetched filing record — never re-derives it from the current webhook body. */
async function sendDraftReadySummaryAndActions(deps: DraftReadySendDeps, sendInput: SendFilingSignMessageInput, filing: FilingRecord): Promise<boolean> {
  const summaryDelivered = await sendDraftReadySummary(deps, sendInput, filing);
  const actionsDelivered = await sendDraftReadyActions(deps.filingSignSenderDeps, sendInput);
  return summaryDelivered && actionsDelivered;
}

/** Read-only lookup of the active draft, for redisplaying the draft-ready screen on unrecognized input — never mutates anything. */
async function currentActiveFiling(deps: FilingSignWorkflowDeps, conversationId: string): Promise<FilingRecord | null> {
  return deps.withTransaction((tx) => deps.filingRepo.findActiveDraft(tx, conversationId));
}

// ---------------------------------------------------------------------------
// FILING_DRAFT_READY dispatch: Review & e-Sign / Edit details.
// ---------------------------------------------------------------------------

export async function handleFilingDraftReadyInput(deps: FilingSignWorkflowDeps, input: FilingSignActionInput): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);
  const action = parseDraftReadyAction(input.selection);

  if (!action) {
    const filing = await currentActiveFiling(deps, input.conversationId);
    if (!filing) {
      // Nothing to redisplay (draft already gone) — safe no-op.
      return { delivered: true };
    }
    return { delivered: await sendDraftReadySummaryAndActions(deps, sendInput, filing) };
  }

  if (action === "filing:esign") {
    return openOtpPrompt(deps, input);
  }

  // filing:edit-details
  return returnToReview(deps, input);
}

async function openOtpPrompt(deps: FilingSignWorkflowDeps, input: FilingSignActionInput): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_DRAFT_READY") {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    await deps.filingRepo.setCurrentStep(tx, filing.id, "FILING_OTP_PENDING");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_OTP_PENDING");
    return { committed: true, sends: [{ messageType: "FILING_OTP_PROMPT" as const, dedupeSuffix: "filing-otp-prompt" }] };
  });

  if (!commit.committed) {
    return { delivered: true };
  }
  const delivered = await sendFilingPlainText(deps, sendInput, otpPromptText(input.whatsappNumber, input.language), "filing_otp_prompt_send_failed");
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

async function returnToReview(deps: FilingSignWorkflowDeps, input: FilingSignActionInput): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);
  let resumedFiling: FilingRecord | null = null;

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_DRAFT_READY") {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    // No filing/party data is touched — only the step/state move back to
    // Phase 5's review screen, so "no data loss" is automatic here.
    await deps.filingRepo.setCurrentStep(tx, filing.id, "FILING_REVIEW");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_REVIEW");
    resumedFiling = { ...filing, currentStep: "FILING_REVIEW" };
    return {
      committed: true,
      sends: [
        { messageType: "FILING_REVIEW_SUMMARY" as const, dedupeSuffix: "filing-review-summary" },
        { messageType: "FILING_REVIEW_ACTIONS" as const, dedupeSuffix: "filing-review-actions" },
      ],
    };
  });

  if (!commit.committed || !resumedFiling) {
    return { delivered: true };
  }

  const delivered = await resendFilingReviewPromptForResume(deps.filingReviewWorkflowDeps, resumedFiling, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  await finalizeOutbound(deps, commit.outboundIds[1], delivered);
  return { delivered };
}

/**
 * Generates a diary number and records the filing as filed — shared by the
 * real OTP-valid cascade below and filing-workflow.ts's legacy
 * FILING_FILED_START resume-translation (#35), which must produce the
 * exact same result rather than a second, potentially-diverging
 * implementation. Returns the updated record so the caller can render the
 * filed-summary message without a second read inside the same transaction.
 */
export async function recordFilingAsFiled(filingRepo: FilingRepository, tx: RepositoryTransaction, filing: FilingRecord): Promise<FilingRecord> {
  const filedAt = new Date();
  const diaryNumber = await filingRepo.nextDiaryNumber(tx, filedAt);
  await filingRepo.recordFiled(tx, filing.id, { diaryNumber, filedAt });
  return { ...filing, status: "FILED", diaryNumber, filedAt, currentStep: "FILING_FILED" };
}

// ---------------------------------------------------------------------------
// FILING_OTP_PENDING: a format-only check, cascading into Prototype parity
// - Phase 7's entry state (FILING_FILED, #35) once valid.
// ---------------------------------------------------------------------------

export async function handleFilingOtpInput(deps: FilingSignWorkflowDeps, input: FilingSignFieldInputEvent): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);

  if (input.mediaCount > 0 || !isValidOtpFormat(input.text)) {
    return { delivered: await sendFilingPlainText(deps, sendInput, OTP_BAD_TEXT[input.language], "filing_otp_bad_send_failed") };
  }

  let filedFiling: FilingRecord | null = null;
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_OTP_PENDING") {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    filedFiling = await recordFilingAsFiled(deps.filingRepo, tx, filing);
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_FILED");
    return {
      committed: true,
      sends: [
        { messageType: "FILING_FILED_SUMMARY" as const, dedupeSuffix: "filing-filed-summary" },
        { messageType: "FILING_FILED_ACTIONS" as const, dedupeSuffix: "filing-filed-actions" },
      ],
    };
  });

  if (!commit.committed || !filedFiling) {
    return { delivered: true };
  }

  const summaryDelivered = await sendFiledSummary(deps, sendInput, filedFiling);
  await finalizeOutbound(deps, commit.outboundIds[0], summaryDelivered);
  const actionsDelivered = await sendFiledActions(deps.filingCompletionSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[1], actionsDelivered);
  return { delivered: summaryDelivered && actionsDelivered };
}

// ---------------------------------------------------------------------------
// Resume support for #8's filing-workflow.ts.
// ---------------------------------------------------------------------------

/** Resends whatever the advocate should see for a draft resumed into one of #34's steps. Read-only: never mutates anything. Deps kept narrow — resuming needs nothing beyond sending. */
export async function resendFilingSignPromptForResume(
  deps: { messagingClient: TwilioMessagingClient; fromNumber: string; filingSignSenderDeps: FilingSignSenderDeps },
  filing: FilingRecord,
  sendInput: SendFilingSignMessageInput,
): Promise<boolean> {
  if (filing.currentStep === "FILING_DRAFT_READY" || filing.currentStep === "DRAFT_READY_START") {
    return sendDraftReadySummaryAndActions(deps, sendInput, filing);
  }
  if (filing.currentStep === "FILING_OTP_PENDING") {
    return sendFilingPlainText(deps, sendInput, otpPromptText(sendInput.to, sendInput.language), "filing_otp_resume_prompt_send_failed");
  }
  // Unreachable given filing-workflow.ts only calls this for steps in FILING_SIGN_SUPPORTED_FILING_STEPS.
  return false;
}
