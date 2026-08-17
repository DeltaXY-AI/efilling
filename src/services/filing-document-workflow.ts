import {
  DOCUMENT_GROUP_LIMITS,
  DOCUMENT_GROUP_ORDER,
  hasMetMinimum,
  parseFilingDocumentAction,
  wouldExceedMaximum,
  type FilingDocumentGroup,
} from "../domain/filing-document";
import type { TwilioMessagingClient } from "../adapters/twilio/messaging-client";
import type { ConversationRepository, ConversationState } from "../repositories/conversation-repository";
import type { FilingDocumentRepository } from "../repositories/filing-document-repository";
import type { FilingRepository } from "../repositories/filing-repository";
import type { OutboundMessageRepository, OutboundMessageType } from "../repositories/outbound-message-repository";
import type { RepositoryTransaction } from "../repositories/transaction";
import type { ComplainantSenderDeps } from "./complainant-sender";
import { sendComplainantRolePrompt } from "./complainant-sender";
import { sendCourtPrompt, type FilingDetailsSenderDeps } from "./filing-details-sender";
import { sendFilingPlainText } from "./filing-sender";
import type { SupportedLanguage } from "./main-menu-sender";
import { storeFilingDocument, type FilingDocumentStorageDeps } from "./filing-document-storage";
import { commitWithOutbound, finalizeOutbound } from "./transactional-outbound";
import type { InboundMedia } from "../types/inbound-message";
import type { FilingWorkflowResult } from "./filing-workflow";

/**
 * Implements #31 (Prototype parity — Phase 3): collecting the 5 document
 * groups — cheque, bank return memo, notice + proof of service, complainant
 * ID proof, optional supporting documents — as real WhatsApp media,
 * persisted durably. Mirrors complainant-workflow.ts's shape: one generic
 * handler shared by all 5 states via table lookups, thin exported wrappers,
 * and a resend-for-resume function consumed by filing-workflow.ts.
 *
 * Also implements #32 (Prototype parity — Phase 4, Option A — no OCR): once
 * the last (support) group is done, this same file sends the "got your
 * documents" acknowledgement (ALL_RECEIVED_TEXT below) and cascades straight
 * into COMPLAINANT_NAME_PENDING in the same transaction — there is no
 * separate "processing"/"extracted" state for #32 to add, matching how #9's
 * enrolment-recording message already works.
 *
 * Prompts/errors have no Content Template — sent with the same
 * `sendFilingPlainText` helper every other plain-text message in this
 * codebase uses.
 */

export interface FilingDocumentWorkflowDeps {
  conversationRepo: ConversationRepository;
  filingRepo: FilingRepository;
  filingDocumentRepo: FilingDocumentRepository;
  /** Durable outbound intent, enqueued inside the same transaction as each committed state change — see commitWithOutbound in transactional-outbound.ts. */
  outboundMessageRepo: OutboundMessageRepository;
  messagingClient: TwilioMessagingClient;
  fromNumber: string;
  /** Downloads from Twilio's MediaUrl and re-uploads to durable storage (#31 Part D) — the only place in this codebase that accepts inbound media. */
  documentStorageDeps: FilingDocumentStorageDeps;
  /** Reused as-is for the "Filing as" role prompt sent once all 5 groups are done (#33 Part A cascade target) — never a second implementation. */
  complainantSenderDeps: ComplainantSenderDeps;
  /** Reused as-is for the court prompt sent once Part E's optional written-account group is done (#33 Part F cascade target) — never a second implementation. */
  filingDetailsSenderDeps: FilingDetailsSenderDeps;
  withTransaction: <T>(fn: (tx: RepositoryTransaction) => Promise<T>) => Promise<T>;
}

export interface FilingDocumentInputEvent {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
  text: string;
  buttonPayload?: string;
  buttonText?: string;
  /** The actual media attachments on this inbound message — unlike every other workflow in this codebase, this one consumes them rather than rejecting media-only input. */
  media: InboundMedia[];
}

interface SendInput {
  to: string;
  language: SupportedLanguage;
  correlationId: string;
}

function sendInputFor(input: { whatsappNumber: string; language: SupportedLanguage; messageId: string }): SendInput {
  return { to: input.whatsappNumber, language: input.language, correlationId: input.messageId };
}

function sendPlain(deps: FilingDocumentWorkflowDeps, sendInput: SendInput, body: string, errorCode: string): Promise<boolean> {
  return sendFilingPlainText(deps, sendInput, body, errorCode);
}

// ---------------------------------------------------------------------------
// State <-> group wiring (mirrors complainant-workflow.ts's Part A tables)
// ---------------------------------------------------------------------------

const GROUP_STATE: Record<FilingDocumentGroup, ConversationState> = {
  cheque: "FILING_DOC_CHEQUE",
  memo: "FILING_DOC_MEMO",
  notice: "FILING_DOC_NOTICE",
  id: "FILING_DOC_ID",
  support: "FILING_DOC_SUPPORT",
  // #33 Part E — reached from a different part of the flow (after Part D's
  // witness field), never from the 5-group cascade above.
  narrative: "FILING_WRITTEN_ACCOUNT_PENDING",
};

const STATE_TO_GROUP: Partial<Record<string, FilingDocumentGroup>> = {
  FILING_DOC_CHEQUE: "cheque",
  FILING_DOC_MEMO: "memo",
  FILING_DOC_NOTICE: "notice",
  FILING_DOC_ID: "id",
  FILING_DOC_SUPPORT: "support",
  FILING_WRITTEN_ACCOUNT_PENDING: "narrative",
};

// #33 Part A: the "support" group's cascade target is now COMPLAINANT_ROLE_PENDING
// (the Complainant screen's new first field), not COMPLAINANT_NAME_PENDING
// directly. #33 Part E: "narrative"'s cascade target is Part F's court
// screen — "narrative" is never itself a `next` target (see GROUP_STATE
// above), so it never appears on the left of this map except as itself.
const NEXT_GROUP: Record<FilingDocumentGroup, FilingDocumentGroup | "complainant" | "court"> = {
  cheque: "memo",
  memo: "notice",
  notice: "id",
  id: "support",
  support: "complainant",
  narrative: "court",
};

const GROUP_PROMPT_OUTBOUND_TYPE: Record<FilingDocumentGroup, OutboundMessageType> = {
  cheque: "FILING_DOC_CHEQUE_PROMPT",
  memo: "FILING_DOC_MEMO_PROMPT",
  notice: "FILING_DOC_NOTICE_PROMPT",
  id: "FILING_DOC_ID_PROMPT",
  support: "FILING_DOC_SUPPORT_PROMPT",
  narrative: "FILING_WRITTEN_ACCOUNT_PROMPT",
};

/** Every currentStep #31 can resume into — combined into filing-workflow.ts's SUPPORTED_FILING_STEPS. #33 Part E adds FILING_WRITTEN_ACCOUNT_PENDING, reached separately from the 5-group cascade. */
export const FILING_DOCUMENT_SUPPORTED_STEPS: ReadonlySet<string> = new Set([...DOCUMENT_GROUP_ORDER.map((group) => GROUP_STATE[group]), "FILING_WRITTEN_ACCOUNT_PENDING"]);

// ---------------------------------------------------------------------------
// Content (#31 Part E — base sentences are verbatim from PR.md Appendix A.4;
// the instructional suffix is this codebase's own addition, since the
// prototype's version relies on a native file-picker UI that a WhatsApp
// numbered/typed fallback has no equivalent for).
// ---------------------------------------------------------------------------

const GROUP_BASE_PROMPT: Record<FilingDocumentGroup, Record<SupportedLanguage, string>> = {
  cheque: {
    en: "The cheque. Photograph the cheque that bounced. Front and back, in good light.",
    ml: "ചെക്ക്. മടങ്ങിയ ചെക്കിന്റെ ഫോട്ടോ എടുക്കുക.",
  },
  memo: {
    en: "The memo the bank gave you when the cheque was returned unpaid.",
    ml: "ചെക്ക് മടങ്ങിയപ്പോൾ ബാങ്ക് നൽകിയ മെമ്മോ.",
  },
  notice: {
    en: "The demand notice you sent, and the proof that it reached the accused.",
    ml: "നിങ്ങൾ അയച്ച ഡിമാൻഡ് നോട്ടീസും അത് എതിർകക്ഷിക്ക് ലഭിച്ചതിന്റെ തെളിവും.",
  },
  id: {
    en: "Aadhaar or PAN of the complainant. Mask the first 8 digits if you upload Aadhaar.",
    ml: "പരാതിക്കാരന്റെ ആധാർ അല്ലെങ്കിൽ പാൻ. ആധാർ ആണെങ്കിൽ ആദ്യ 8 അക്കങ്ങൾ മറയ്ക്കുക.",
  },
  support: {
    en: "Optional, but they make the complaint stronger.",
    ml: "നിർബന്ധമല്ല, പക്ഷേ പരാതി ശക്തമാക്കും.",
  },
  // #33 Part E — an alternative to typing the story (Part D): if you
  // already have a written account, upload it here instead.
  narrative: {
    en: "Already written it down? If you have a written account of what happened, upload it here instead of typing it.",
    ml: "ഇത് നേരത്തെ എഴുതി വെച്ചിട്ടുണ്ടോ? എന്താണ് സംഭവിച്ചത് എന്നതിന്റെ രേഖാമൂലമുള്ള വിവരണം ഉണ്ടെങ്കിൽ, ടൈപ്പ് ചെയ്യുന്നതിന് പകരം ഇവിടെ അപ്‌ലോഡ് ചെയ്യുക.",
  },
};

function instructionSuffix(group: FilingDocumentGroup, language: SupportedLanguage): string {
  const { min, max } = DOCUMENT_GROUP_LIMITS[group];
  const countPhrase = min === max ? `${min}` : `${min}-${max}`;

  if (language === "ml") {
    return min === 0
      ? `പരമാവധി ${max} ഫോട്ടോ അല്ലെങ്കിൽ PDF അയക്കുക, അല്ലെങ്കിൽ "കഴിഞ്ഞു" എന്ന് മറുപടി നൽകി ഒഴിവാക്കുക.`
      : `${countPhrase} ഫോട്ടോ അല്ലെങ്കിൽ PDF അയക്കുക, എന്നിട്ട് "കഴിഞ്ഞു" എന്ന് മറുപടി നൽകുക.`;
  }
  return min === 0
    ? `Send up to ${max} photos or PDFs, or reply "done" to skip.`
    : `Send ${countPhrase} photo(s) or PDF(s), then reply "done".`;
}

function promptText(group: FilingDocumentGroup, language: SupportedLanguage): string {
  return `${GROUP_BASE_PROMPT[group][language]}\n\n${instructionSuffix(group, language)}`;
}

const UNSUPPORTED_TYPE_TEXT: Record<SupportedLanguage, string> = {
  en: "That file type isn't supported here. Please send a photo (JPEG or PNG) or a PDF.",
  ml: "ആ ഫയൽ തരം ഇവിടെ പിന്തുണയ്ക്കുന്നില്ല. ദയവായി ഒരു ഫോട്ടോ (JPEG അല്ലെങ്കിൽ PNG) അല്ലെങ്കിൽ PDF അയക്കുക.",
};

const TOO_LARGE_TEXT: Record<SupportedLanguage, string> = {
  en: "That file is too large. Please send a file under 10 MB.",
  ml: "ആ ഫയൽ വളരെ വലുതാണ്. ദയവായി 10 MB-യിൽ താഴെയുള്ള ഫയൽ അയക്കുക.",
};

const DOWNLOAD_FAILED_TEXT: Record<SupportedLanguage, string> = {
  en: "We couldn't process that file. Please try sending it again.",
  ml: "ആ ഫയൽ പ്രോസസ് ചെയ്യാൻ കഴിഞ്ഞില്ല. വീണ്ടും അയക്കാൻ ശ്രമിക്കുക.",
};

const UNRECOGNIZED_INPUT_TEXT: Record<SupportedLanguage, string> = {
  en: 'Please send this document as a photo or PDF, or reply "done" once you\'ve sent enough.',
  ml: 'ഈ രേഖ ഫോട്ടോ അല്ലെങ്കിൽ PDF ആയി അയക്കുക, അല്ലെങ്കിൽ ആവശ്യത്തിന് അയച്ചു കഴിഞ്ഞാൽ "കഴിഞ്ഞു" എന്ന് മറുപടി നൽകുക.',
};

// #32 (Prototype parity — Phase 4, Option A: no OCR): the prototype's
// `uploadedAck` promises "I'm reading them now ... this usually takes under
// a minute" — a promise this codebase cannot keep, since it has no
// OCR/document-AI extraction step. That line is deliberately dropped; this
// is an honest "received" acknowledgement followed by a direct handoff into
// typed case-detail entry, not a "give me a moment" that leads nowhere.
// ML wording is this codebase's own translation of the adjusted (non-OCR)
// English above — the prototype's own Malayalam text for this screen
// assumes the reading illusion and is not reusable verbatim here.
const ALL_RECEIVED_TEXT: Record<SupportedLanguage, string> = {
  en: "✓ Got all your documents.\n\nThanks - let's go through the case details next.",
  ml: "✓ നിങ്ങളുടെ എല്ലാ രേഖകളും ലഭിച്ചു.\n\nനന്ദി - അടുത്തതായി കേസിന്റെ വിവരങ്ങളിലേക്ക് കടക്കാം.",
};

function receivedAckText(group: FilingDocumentGroup, count: number, language: SupportedLanguage): string {
  const { max } = DOCUMENT_GROUP_LIMITS[group];
  if (count >= max) {
    return language === "ml"
      ? `ലഭിച്ചു — ഇത് ഈ ഗ്രൂപ്പിനുള്ള പരമാവധി (${max}) ആണ്. തുടരാൻ "കഴിഞ്ഞു" എന്ന് മറുപടി നൽകുക.`
      : `Got it — that's the maximum (${max}) for this group. Reply "done" to continue.`;
  }
  return language === "ml"
    ? `ലഭിച്ചു — ${max}-ൽ ${count} എണ്ണം ലഭിച്ചു. ഇനിയൊന്ന് അയക്കുക, അല്ലെങ്കിൽ പൂർത്തിയായാൽ "കഴിഞ്ഞു" എന്ന് മറുപടി നൽകുക.`
    : `Got it — ${count} of ${max} received. Send another, or reply "done" when finished.`;
}

function maxReachedText(group: FilingDocumentGroup, language: SupportedLanguage): string {
  const { max } = DOCUMENT_GROUP_LIMITS[group];
  return language === "ml"
    ? `ഈ ഗ്രൂപ്പിന് അനുവദനീയമായ പരമാവധി ${max} ഫയലുകൾ ഇതിനകം ലഭിച്ചു. തുടരാൻ "കഴിഞ്ഞു" എന്ന് മറുപടി നൽകുക.`
    : `You've already reached the maximum of ${max} files for this group. Reply "done" to continue.`;
}

function minNotMetText(group: FilingDocumentGroup, language: SupportedLanguage): string {
  const { min } = DOCUMENT_GROUP_LIMITS[group];
  return language === "ml"
    ? `തുടരുന്നതിന് മുൻപ് കുറഞ്ഞത് ${min} ഫയൽ(കൾ) അയക്കുക.`
    : `Please send at least ${min} file(s) before continuing.`;
}

// ---------------------------------------------------------------------------
// Media input (issue #31 Part D): download from Twilio, validate, upload to
// durable storage, append a filing_documents row. Never touches conversation
// state — only `docs:continue` (below) advances the workflow.
// ---------------------------------------------------------------------------

async function handleMediaMessages(
  deps: FilingDocumentWorkflowDeps,
  group: FilingDocumentGroup,
  input: FilingDocumentInputEvent,
): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);

  const conversation = await deps.conversationRepo.findByWhatsappNumber(input.whatsappNumber);
  if (!conversation || conversation.state !== GROUP_STATE[group]) {
    // Stale (state already moved on by the time this was processed) — safe no-op, matches every other state in this codebase.
    return { delivered: true };
  }
  const filing = await deps.withTransaction((tx) => deps.filingRepo.findActiveDraft(tx, conversation.id));
  if (!filing) {
    return { delivered: true };
  }
  const filingId = filing.id;

  // In the overwhelming majority of real WhatsApp deliveries a message
  // carries exactly one media attachment; this loop also handles the rare
  // multi-attachment case, one item at a time, stopping (without discarding
  // already-stored items) the moment the group's max would be exceeded.
  let ackText = "";
  for (const item of input.media) {
    const currentCount = await deps.withTransaction((tx) => deps.filingDocumentRepo.countByGroup(tx, filingId, group));

    if (wouldExceedMaximum(group, currentCount)) {
      ackText = maxReachedText(group, input.language);
      break;
    }

    const result = await storeFilingDocument(deps.documentStorageDeps, {
      mediaUrl: item.url,
      contentTypeHint: item.contentType,
      filingId,
      documentGroup: group,
    });

    if (!result.ok) {
      // "storage_failed" (upload-side failure) shares download_failed's text
      // — from the sender's point of view both mean the same thing: "we
      // couldn't process that file, please try again."
      ackText =
        result.reason === "unsupported_type"
          ? UNSUPPORTED_TYPE_TEXT[input.language]
          : result.reason === "too_large"
            ? TOO_LARGE_TEXT[input.language]
            : DOWNLOAD_FAILED_TEXT[input.language];
      continue;
    }

    await deps.withTransaction((tx) =>
      deps.filingDocumentRepo.addDocument(tx, {
        filingId,
        documentGroup: group,
        storageUrl: result.storageUrl,
        contentType: result.contentType,
        originalTwilioMediaUrl: item.url,
      }),
    );
    ackText = receivedAckText(group, currentCount + 1, input.language);
  }

  return { delivered: await sendPlain(deps, sendInput, ackText, "filing_document_ack_send_failed") };
}

// ---------------------------------------------------------------------------
// "docs:continue" (issue #31 Part A): advances to the next group once the
// minimum is met, or the terminal cascade into COMPLAINANT_NAME_PENDING
// after the last (support) group.
// ---------------------------------------------------------------------------

async function handleContinueAction(deps: FilingDocumentWorkflowDeps, group: FilingDocumentGroup, input: FilingDocumentInputEvent): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);
  let sawActiveDraft = false;
  let minMet = true;

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== GROUP_STATE[group]) {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    sawActiveDraft = true;

    const count = await deps.filingDocumentRepo.countByGroup(tx, filing.id, group);
    if (!hasMetMinimum(group, count)) {
      minMet = false;
      return { committed: false };
    }

    const next = NEXT_GROUP[group];
    if (next === "complainant") {
      // #33 Part A: cascades into COMPLAINANT_ROLE_PENDING (the Complainant
      // screen's new first field), not COMPLAINANT_NAME_PENDING directly.
      await deps.filingRepo.setCurrentStep(tx, filing.id, "COMPLAINANT_ROLE_PENDING");
      await deps.conversationRepo.setStateInTx(tx, locked.id, "COMPLAINANT_ROLE_PENDING");
      return {
        committed: true,
        sends: [
          { messageType: "FILING_DOC_ALL_RECEIVED" as const, dedupeSuffix: "filing-doc-all-received" },
          { messageType: "COMPLAINANT_ROLE_PROMPT" as const, dedupeSuffix: "complainant-role-prompt" },
        ],
      };
    }
    if (next === "court") {
      // #33 Part E -> Part F: the optional written-account group cascades
      // straight into court selection, the same "no dead state" pattern.
      await deps.filingRepo.setCurrentStep(tx, filing.id, "FILING_COURT_PENDING");
      await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_COURT_PENDING");
      return { committed: true, sends: [{ messageType: "FILING_COURT_PROMPT" as const, dedupeSuffix: "filing-court-prompt" }] };
    }

    await deps.filingRepo.setCurrentStep(tx, filing.id, GROUP_STATE[next]);
    await deps.conversationRepo.setStateInTx(tx, locked.id, GROUP_STATE[next]);
    return { committed: true, sends: [{ messageType: GROUP_PROMPT_OUTBOUND_TYPE[next], dedupeSuffix: `${next}-prompt` }] };
  });

  if (!commit.committed) {
    if (sawActiveDraft && !minMet) {
      return { delivered: await sendPlain(deps, sendInput, minNotMetText(group, input.language), "filing_document_min_not_met_send_failed") };
    }
    // Stale (state/draft already moved on) — safe no-op.
    return { delivered: true };
  }

  const next = NEXT_GROUP[group];
  if (next === "complainant") {
    const allReceivedDelivered = await sendPlain(deps, sendInput, ALL_RECEIVED_TEXT[input.language], "filing_document_all_received_send_failed");
    await finalizeOutbound(deps, commit.outboundIds[0], allReceivedDelivered);

    const rolePromptDelivered = await sendComplainantRolePrompt(deps.complainantSenderDeps, sendInput);
    await finalizeOutbound(deps, commit.outboundIds[1], rolePromptDelivered);
    return { delivered: allReceivedDelivered && rolePromptDelivered };
  }
  if (next === "court") {
    const delivered = await sendCourtPrompt(deps.filingDetailsSenderDeps, sendInput);
    await finalizeOutbound(deps, commit.outboundIds[0], delivered);
    return { delivered };
  }

  const delivered = await sendPlain(deps, sendInput, promptText(next, input.language), `filing_document_${next}_prompt_send_failed`);
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

// ---------------------------------------------------------------------------
// Entry point + exported per-group wrappers
// ---------------------------------------------------------------------------

async function handleFilingDocumentGroupInput(
  deps: FilingDocumentWorkflowDeps,
  group: FilingDocumentGroup,
  input: FilingDocumentInputEvent,
): Promise<FilingWorkflowResult> {
  if (input.media.length > 0) {
    return handleMediaMessages(deps, group, input);
  }

  const action = parseFilingDocumentAction({ buttonPayload: input.buttonPayload, buttonText: input.buttonText, body: input.text });
  if (action === "docs:continue") {
    return handleContinueAction(deps, group, input);
  }

  // Part F: a text-only reply must never silently substitute for a required
  // document — same validation error as an unsupported file type would get.
  return { delivered: await sendPlain(deps, sendInputFor(input), UNRECOGNIZED_INPUT_TEXT[input.language], "filing_document_unrecognized_input_send_failed") };
}

export function handleFilingDocChequeInput(deps: FilingDocumentWorkflowDeps, input: FilingDocumentInputEvent): Promise<FilingWorkflowResult> {
  return handleFilingDocumentGroupInput(deps, "cheque", input);
}

export function handleFilingDocMemoInput(deps: FilingDocumentWorkflowDeps, input: FilingDocumentInputEvent): Promise<FilingWorkflowResult> {
  return handleFilingDocumentGroupInput(deps, "memo", input);
}

export function handleFilingDocNoticeInput(deps: FilingDocumentWorkflowDeps, input: FilingDocumentInputEvent): Promise<FilingWorkflowResult> {
  return handleFilingDocumentGroupInput(deps, "notice", input);
}

export function handleFilingDocIdInput(deps: FilingDocumentWorkflowDeps, input: FilingDocumentInputEvent): Promise<FilingWorkflowResult> {
  return handleFilingDocumentGroupInput(deps, "id", input);
}

export function handleFilingDocSupportInput(deps: FilingDocumentWorkflowDeps, input: FilingDocumentInputEvent): Promise<FilingWorkflowResult> {
  return handleFilingDocumentGroupInput(deps, "support", input);
}

/** #33 Part E: the optional written-account upload, reached from Part D's witness field, not the 5-group cascade above. */
export function handleFilingWrittenAccountInput(deps: FilingDocumentWorkflowDeps, input: FilingDocumentInputEvent): Promise<FilingWorkflowResult> {
  return handleFilingDocumentGroupInput(deps, "narrative", input);
}

/**
 * Sends the written-account prompt on its own — used by
 * filing-details-workflow.ts's handleFilingWitnessInput to cascade straight
 * from FILING_WITNESS_PENDING into FILING_WRITTEN_ACCOUNT_PENDING (#33 Part
 * E), which only needs the minimal messaging shape, not the rest of
 * FilingDocumentWorkflowDeps.
 */
export function handleFilingWrittenAccountEntry(deps: { messagingClient: TwilioMessagingClient; fromNumber: string }, sendInput: SendInput): Promise<boolean> {
  return sendFilingPlainText(deps, sendInput, promptText("narrative", sendInput.language), "filing_written_account_prompt_send_failed");
}

/**
 * Sends the cheque-group prompt on its own — used by enrolment-workflow.ts's
 * confirmEnrolment to cascade straight from ADVOCATE_ENROLMENT_CONFIRM into
 * FILING_DOC_CHEQUE (#31), which only needs the minimal messaging shape, not
 * the rest of FilingDocumentWorkflowDeps.
 */
export function sendFilingDocChequePrompt(deps: { messagingClient: TwilioMessagingClient; fromNumber: string }, sendInput: SendInput): Promise<boolean> {
  return sendFilingPlainText(deps, sendInput, promptText("cheque", sendInput.language), "filing_document_cheque_prompt_send_failed");
}

/**
 * Resend support for #8's filing-workflow.ts draft-resume (mirrors
 * resendComplainantPromptForResume) — resends the current group's initial
 * prompt. Read-only: never mutates the filing/conversation itself.
 */
export function resendFilingDocumentPromptForResume(
  deps: { messagingClient: TwilioMessagingClient; fromNumber: string },
  currentStep: string,
  sendInput: SendInput,
): Promise<boolean> {
  const group = STATE_TO_GROUP[currentStep];
  if (!group) {
    // Unreachable given filing-workflow.ts only calls this for steps in FILING_DOCUMENT_SUPPORTED_STEPS.
    return Promise.resolve(false);
  }
  return sendFilingPlainText(deps, sendInput, promptText(group, sendInput.language), `filing_document_${group}_resume_prompt_send_failed`);
}
