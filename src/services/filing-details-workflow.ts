import {
  computeLimitationWindow,
  daysUntilIso,
  formatIsoDateAsDisplay,
  isSkipSelection,
  parsePartPaymentSelection,
  parseReturnReasonSelection,
  parseWitnessSelection,
  validateBankBranch,
  validateChequeNumber,
  validateFilingAmount,
  validateFilingDate,
  validateNarrative,
  type FilingDetailSelectionInput,
  type LimitationWindow,
} from "../domain/filing-details";
import type { TwilioMessagingClient } from "../adapters/twilio/messaging-client";
import type { ConversationRepository, ConversationState } from "../repositories/conversation-repository";
import type { FilingRepository, UpsertFilingFieldsInput } from "../repositories/filing-repository";
import type { OutboundMessageRepository, OutboundMessageType } from "../repositories/outbound-message-repository";
import type { RepositoryTransaction } from "../repositories/transaction";
import {
  sendPartPaymentPrompt,
  sendReturnReasonPrompt,
  sendWitnessPrompt,
  type FilingDetailsSenderDeps,
  type SendFilingDetailsMessageInput,
} from "./filing-details-sender";
import { sendFilingPlainText } from "./filing-sender";
import type { SupportedLanguage } from "./main-menu-sender";
import { handleFilingWrittenAccountEntry } from "./filing-document-workflow";
import { commitWithOutbound, finalizeOutbound } from "./transactional-outbound";
import type { FilingWorkflowResult } from "./filing-workflow";

/**
 * Implements #33 (Prototype parity — Phase 5) Parts C-D: cheque and notice
 * particulars, then the transaction narrative — 11 sequential fields, no
 * per-section review of their own (Part F's single combined review covers
 * everything collected here, mirroring how #31's document-upload groups
 * have no per-group review either). 8 fields are plain free text (no
 * Content Template, sent with the same `sendFilingPlainText` helper every
 * other plain-text message in this codebase uses); 3 (return reason, paid,
 * witness) are selections with real Content Templates, defined in
 * filing-details-sender.ts.
 *
 * This file must never import from filing-workflow.ts — filing-workflow.ts
 * imports `resendFilingDetailsPromptForResume` from here (mirroring #10/#11),
 * so the dependency only ever runs one way. It imports
 * `handleFilingWrittenAccountEntry` from filing-document-workflow.ts (#33
 * Part E's entry point, cascading from the last field here), which must
 * never import back from here.
 */

export interface FilingDetailsWorkflowDeps {
  conversationRepo: ConversationRepository;
  filingRepo: FilingRepository;
  /** Durable outbound intent, enqueued inside the same transaction as each committed state change — see commitWithOutbound in transactional-outbound.ts. */
  outboundMessageRepo: OutboundMessageRepository;
  messagingClient: TwilioMessagingClient;
  fromNumber: string;
  filingDetailsSenderDeps: FilingDetailsSenderDeps;
  withTransaction: <T>(fn: (tx: RepositoryTransaction) => Promise<T>) => Promise<T>;
}

export interface FilingDetailsFieldInputEvent {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
  text: string;
  mediaCount: number;
}

export interface FilingDetailsActionInput {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
  selection: FilingDetailSelectionInput;
}

export type TextFieldKey = "chequeNumber" | "chequeDate" | "amount" | "bankBranch" | "memoDate" | "noticeDate" | "serviceDate" | "story";
// "witness" itself is a bespoke selection field (see handleFilingWitnessInput)
// reached only from `story`'s NEXT_FIELD entry — it never has its own
// "next" sentinel, since witness always cascades straight into Part E's
// FILING_WRITTEN_ACCOUNT_PENDING, handled directly in handleFilingWitnessInput.
type NextTarget = TextFieldKey | "return-reason" | "part-payment" | "witness";

function sendInputFor(input: { whatsappNumber: string; language: SupportedLanguage; messageId: string }): SendFilingDetailsMessageInput {
  return { to: input.whatsappNumber, language: input.language, correlationId: input.messageId };
}

// ---------------------------------------------------------------------------
// Field copy — plain, in-session messages; no Content Template.
// ---------------------------------------------------------------------------

/** Exported for reuse by filing-review-workflow.ts's Part F edit dispatch — never a second copy of this text. */
export const PROMPT_TEXT: Record<TextFieldKey, Record<SupportedLanguage, string>> = {
  chequeNumber: {
    en: "Enter the cheque number.",
    ml: "ചെക്ക് നമ്പർ നൽകുക.",
  },
  chequeDate: {
    en: ["Enter the cheque date.", "", "Format: DD-MM-YYYY, e.g. 12-03-2026"].join("\n"),
    ml: ["ചെക്ക് തീയതി നൽകുക.", "", "ഫോർമാറ്റ്: DD-MM-YYYY, ഉദാ: 12-03-2026"].join("\n"),
  },
  amount: {
    en: ["Enter the cheque amount, in rupees.", "", "Example: 450000 or 4,50,000"].join("\n"),
    ml: ["ചെക്ക് തുക രൂപയിൽ നൽകുക.", "", "ഉദാഹരണം: 450000 അല്ലെങ്കിൽ 4,50,000"].join("\n"),
  },
  bankBranch: {
    en: ["Enter the bank and branch the cheque was drawn on.", "", "If you'd rather not say, reply Skip."].join("\n"),
    ml: ["ചെക്ക് നൽകിയ ബാങ്കും ബ്രാഞ്ചും നൽകുക.", "", "പറയാൻ താല്പര്യമില്ലെങ്കിൽ, ഒഴിവാക്കുക എന്ന് മറുപടി നൽകുക."].join("\n"),
  },
  memoDate: {
    en: ["Enter the date on the bank's return memo.", "", "Format: DD-MM-YYYY"].join("\n"),
    ml: ["ബാങ്കിന്റെ മടക്ക മെമ്മോയിലെ തീയതി നൽകുക.", "", "ഫോർമാറ്റ്: DD-MM-YYYY"].join("\n"),
  },
  noticeDate: {
    en: ["Enter the date you sent the demand notice.", "", "Format: DD-MM-YYYY"].join("\n"),
    ml: ["നിങ്ങൾ ഡിമാൻഡ് നോട്ടീസ് അയച്ച തീയതി നൽകുക.", "", "ഫോർമാറ്റ്: DD-MM-YYYY"].join("\n"),
  },
  serviceDate: {
    en: ["Enter the date the notice was served on the accused.", "", "Format: DD-MM-YYYY"].join("\n"),
    ml: ["നോട്ടീസ് എതിർകക്ഷിക്ക് നൽകിയ തീയതി നൽകുക.", "", "ഫോർമാറ്റ്: DD-MM-YYYY"].join("\n"),
  },
  story: {
    en: [
      "What happened, in your own words? (optional)",
      "",
      "When you lent it, what for, and what was agreed.",
      "",
      "If you'd rather skip this, reply Skip.",
    ].join("\n"),
    ml: [
      "എന്താണ് സംഭവിച്ചത്, നിങ്ങളുടെ വാക്കുകളിൽ? (നിർബന്ധമല്ല)",
      "",
      "എപ്പോൾ കടം കൊടുത്തു, എന്തിനാണ്, എന്ത് ധാരണയായിരുന്നു എന്നത്.",
      "",
      "ഒഴിവാക്കണമെങ്കിൽ, ഒഴിവാക്കുക എന്ന് മറുപടി നൽകുക.",
    ].join("\n"),
  },
};

/** Exported for reuse by filing-review-workflow.ts's Part F edit dispatch — never a second copy of this text. */
export const ERROR_TEXT: Record<TextFieldKey, Record<SupportedLanguage, string>> = {
  chequeNumber: {
    en: "That doesn't look like a valid cheque number. Enter up to 40 characters.",
    ml: "അത് സാധുവായ ചെക്ക് നമ്പർ ആയി തോന്നുന്നില്ല. പരമാവധി 40 അക്ഷരങ്ങൾ നൽകുക.",
  },
  chequeDate: {
    en: "That doesn't look like a valid date. Use the format DD-MM-YYYY, e.g. 12-03-2026.",
    ml: "അത് സാധുവായ തീയതി ആയി തോന്നുന്നില്ല. DD-MM-YYYY ഫോർമാറ്റ് ഉപയോഗിക്കുക, ഉദാ: 12-03-2026.",
  },
  amount: {
    en: "That doesn't look like a valid amount. Enter digits only, e.g. 450000 or 4,50,000.",
    ml: "അത് സാധുവായ തുക ആയി തോന്നുന്നില്ല. അക്കങ്ങൾ മാത്രം നൽകുക, ഉദാ: 450000 അല്ലെങ്കിൽ 4,50,000.",
  },
  bankBranch: {
    en: "That's too long. Enter up to 200 characters, or reply Skip.",
    ml: "അത് വളരെ നീണ്ടതാണ്. പരമാവധി 200 അക്ഷരങ്ങൾ നൽകുക, അല്ലെങ്കിൽ ഒഴിവാക്കുക.",
  },
  memoDate: {
    en: "That doesn't look like a valid date. Use the format DD-MM-YYYY.",
    ml: "അത് സാധുവായ തീയതി ആയി തോന്നുന്നില്ല. DD-MM-YYYY ഫോർമാറ്റ് ഉപയോഗിക്കുക.",
  },
  noticeDate: {
    en: "That doesn't look like a valid date. Use the format DD-MM-YYYY.",
    ml: "അത് സാധുവായ തീയതി ആയി തോന്നുന്നില്ല. DD-MM-YYYY ഫോർമാറ്റ് ഉപയോഗിക്കുക.",
  },
  serviceDate: {
    en: "That doesn't look like a valid date. Use the format DD-MM-YYYY.",
    ml: "അത് സാധുവായ തീയതി ആയി തോന്നുന്നില്ല. DD-MM-YYYY ഫോർമാറ്റ് ഉപയോഗിക്കുക.",
  },
  story: {
    en: "That's too long. Please keep it under 4000 characters, or reply Skip.",
    ml: "അത് വളരെ നീണ്ടതാണ്. 4000 അക്ഷരങ്ങളിൽ താഴെയായി സൂക്ഷിക്കുക, അല്ലെങ്കിൽ ഒഴിവാക്കുക.",
  },
};

// ---------------------------------------------------------------------------
// Field <-> state/outbound-type/next-field wiring
// ---------------------------------------------------------------------------

const PROMPT_OUTBOUND_TYPE: Record<TextFieldKey, OutboundMessageType> = {
  chequeNumber: "FILING_CHEQUE_NUMBER_PROMPT",
  chequeDate: "FILING_CHEQUE_DATE_PROMPT",
  amount: "FILING_AMOUNT_PROMPT",
  bankBranch: "FILING_BANK_BRANCH_PROMPT",
  memoDate: "FILING_MEMO_DATE_PROMPT",
  noticeDate: "FILING_NOTICE_DATE_PROMPT",
  serviceDate: "FILING_SERVICE_DATE_PROMPT",
  story: "FILING_STORY_PROMPT",
};

const LINEAR_PENDING_STATE: Record<TextFieldKey, ConversationState> = {
  chequeNumber: "FILING_CHEQUE_NUMBER_PENDING",
  chequeDate: "FILING_CHEQUE_DATE_PENDING",
  amount: "FILING_AMOUNT_PENDING",
  bankBranch: "FILING_BANK_BRANCH_PENDING",
  memoDate: "FILING_MEMO_DATE_PENDING",
  noticeDate: "FILING_NOTICE_DATE_PENDING",
  serviceDate: "FILING_SERVICE_DATE_PENDING",
  story: "FILING_STORY_PENDING",
};

// Every text field's "next" — either another text field, or a sentinel for
// one of the 3 selection fields / Part E's entry (a static 1:1 map can't
// route to those, since they're not free-text fields at all).
const NEXT_FIELD: Record<TextFieldKey, NextTarget> = {
  chequeNumber: "chequeDate",
  chequeDate: "amount",
  amount: "bankBranch",
  bankBranch: "return-reason",
  memoDate: "noticeDate",
  noticeDate: "serviceDate",
  serviceDate: "part-payment",
  story: "witness",
};

const RESUMABLE_STEP_TO_FIELD: Partial<Record<string, TextFieldKey>> = {
  FILING_CHEQUE_NUMBER_PENDING: "chequeNumber",
  FILING_CHEQUE_DATE_PENDING: "chequeDate",
  FILING_AMOUNT_PENDING: "amount",
  FILING_BANK_BRANCH_PENDING: "bankBranch",
  FILING_MEMO_DATE_PENDING: "memoDate",
  FILING_NOTICE_DATE_PENDING: "noticeDate",
  FILING_SERVICE_DATE_PENDING: "serviceDate",
  FILING_STORY_PENDING: "story",
};

/** Every currentStep #33 Parts C/D can resume into — combined with the other sets in filing-workflow.ts's SUPPORTED_FILING_STEPS. */
export const FILING_DETAILS_SUPPORTED_FILING_STEPS: ReadonlySet<string> = new Set([
  "FILING_CHEQUE_NUMBER_PENDING",
  "FILING_CHEQUE_DATE_PENDING",
  "FILING_AMOUNT_PENDING",
  "FILING_BANK_BRANCH_PENDING",
  "FILING_RETURN_REASON_PENDING",
  "FILING_MEMO_DATE_PENDING",
  "FILING_NOTICE_DATE_PENDING",
  "FILING_SERVICE_DATE_PENDING",
  "FILING_PART_PAYMENT_PENDING",
  "FILING_STORY_PENDING",
  "FILING_WITNESS_PENDING",
]);

export interface FieldValidationResult {
  valid: boolean;
  patch?: UpsertFilingFieldsInput;
}

/** Exported for reuse by filing-review-workflow.ts's Part F edit dispatch — never a second validator. */
export function validateField(field: TextFieldKey, text: string): FieldValidationResult {
  if (field === "chequeNumber") {
    const result = validateChequeNumber(text);
    return result.valid && result.normalized ? { valid: true, patch: { chequeNumber: result.normalized } } : { valid: false };
  }
  if (field === "chequeDate") {
    const result = validateFilingDate(text);
    return result.valid && result.normalized ? { valid: true, patch: { chequeDate: result.normalized } } : { valid: false };
  }
  if (field === "amount") {
    const result = validateFilingAmount(text);
    return result.valid && result.normalized ? { valid: true, patch: { chequeAmount: result.normalized } } : { valid: false };
  }
  if (field === "bankBranch") {
    const result = validateBankBranch(text);
    return result.valid ? { valid: true, patch: result.normalized !== null ? { bankBranch: result.normalized } : {} } : { valid: false };
  }
  if (field === "memoDate") {
    const result = validateFilingDate(text);
    return result.valid && result.normalized ? { valid: true, patch: { memoDate: result.normalized } } : { valid: false };
  }
  if (field === "noticeDate") {
    const result = validateFilingDate(text);
    return result.valid && result.normalized ? { valid: true, patch: { noticeDate: result.normalized } } : { valid: false };
  }
  if (field === "serviceDate") {
    const result = validateFilingDate(text);
    return result.valid && result.normalized ? { valid: true, patch: { serviceDate: result.normalized } } : { valid: false };
  }
  // story
  const result = validateNarrative(text);
  return result.valid ? { valid: true, patch: result.normalized !== null ? { narrative: result.normalized } : {} } : { valid: false };
}

async function sendValidationError(deps: FilingDetailsWorkflowDeps, sendInput: SendFilingDetailsMessageInput, field: TextFieldKey): Promise<boolean> {
  return sendFilingPlainText(deps, sendInput, ERROR_TEXT[field][sendInput.language], `filing_details_${field}_validation_error_send_failed`);
}

/** Surfaced once, right after the notice-served date is entered — see domain/filing-details.ts's computeLimitationWindow for the underlying S.138 NI Act calculation. */
function limitationNoticeText(window: LimitationWindow, daysLeft: number, language: SupportedLanguage): string {
  const from = formatIsoDateAsDisplay(window.causeOfActionDateIso);
  const to = formatIsoDateAsDisplay(window.limitationDeadlineIso);
  return language === "ml"
    ? `📅 കാലപരിധി: നിങ്ങളുടെ പരാതി ${from} നും ${to} നും ഇടയിൽ ഫയൽ ചെയ്യണം. ${daysLeft} ദിവസം ബാക്കിയുണ്ട്.`
    : `📅 Limitation: your complaint must be filed between ${from} and ${to}. You have ${daysLeft} days left.`;
}

function nextStateFor(next: NextTarget): ConversationState {
  if (next === "return-reason") return "FILING_RETURN_REASON_PENDING";
  if (next === "part-payment") return "FILING_PART_PAYMENT_PENDING";
  if (next === "witness") return "FILING_WITNESS_PENDING";
  return LINEAR_PENDING_STATE[next];
}

// ---------------------------------------------------------------------------
// Linear text-field entry: FILING_CHEQUE_NUMBER_PENDING through
// FILING_STORY_PENDING (skipping the 3 selection fields, handled below).
// ---------------------------------------------------------------------------

async function handleTextFieldInput(deps: FilingDetailsWorkflowDeps, field: TextFieldKey, input: FilingDetailsFieldInputEvent): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);

  if (input.mediaCount > 0 && !input.text.trim()) {
    return { delivered: await sendValidationError(deps, sendInput, field) };
  }

  const validation = validateField(field, input.text);
  if (!validation.valid || !validation.patch) {
    return { delivered: await sendValidationError(deps, sendInput, field) };
  }
  const patch = validation.patch;

  const next = NEXT_FIELD[field];
  const nextState = nextStateFor(next);

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== LINEAR_PENDING_STATE[field]) {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }

    if (Object.keys(patch).length > 0) {
      await deps.filingRepo.upsertFilingFields(tx, filing.id, patch);
    }
    await deps.filingRepo.setCurrentStep(tx, filing.id, nextState);
    await deps.conversationRepo.setStateInTx(tx, locked.id, nextState);

    if (next === "return-reason") {
      return { committed: true, sends: [{ messageType: "FILING_RETURN_REASON_PROMPT" as const, dedupeSuffix: "return-reason-prompt" }] };
    }
    if (field === "serviceDate") {
      // The limitation window is computed from this exact field, so it's
      // surfaced right after — before the part-payment prompt, never
      // replacing it.
      return {
        committed: true,
        sends: [
          { messageType: "FILING_LIMITATION_NOTICE" as const, dedupeSuffix: "limitation-notice" },
          { messageType: "FILING_PART_PAYMENT_PROMPT" as const, dedupeSuffix: "part-payment-prompt" },
        ],
      };
    }
    if (next === "witness") {
      return { committed: true, sends: [{ messageType: "FILING_WITNESS_PROMPT" as const, dedupeSuffix: "witness-prompt" }] };
    }
    if (next === "part-payment") {
      // Unreachable: serviceDate is the only field whose `next` is
      // "part-payment" (see NEXT_FIELD above), and that's always handled by
      // the field === "serviceDate" branch above. Kept only so TS can narrow
      // `next` to TextFieldKey for the PROMPT_OUTBOUND_TYPE lookup below.
      return { committed: true, sends: [{ messageType: "FILING_PART_PAYMENT_PROMPT" as const, dedupeSuffix: "part-payment-prompt" }] };
    }
    return { committed: true, sends: [{ messageType: PROMPT_OUTBOUND_TYPE[next], dedupeSuffix: `${next}-prompt` }] };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  if (next === "return-reason") {
    const delivered = await sendReturnReasonPrompt(deps.filingDetailsSenderDeps, sendInput);
    await finalizeOutbound(deps, commit.outboundIds[0], delivered);
    return { delivered };
  }
  if (field === "serviceDate" && typeof patch.serviceDate === "string") {
    const window = computeLimitationWindow(patch.serviceDate);
    const daysLeft = daysUntilIso(window.limitationDeadlineIso, new Date());
    const noticeDelivered = await sendFilingPlainText(
      deps,
      sendInput,
      limitationNoticeText(window, daysLeft, input.language),
      "filing_limitation_notice_send_failed",
    );
    await finalizeOutbound(deps, commit.outboundIds[0], noticeDelivered);
    const promptDelivered = await sendPartPaymentPrompt(deps.filingDetailsSenderDeps, sendInput);
    await finalizeOutbound(deps, commit.outboundIds[1], promptDelivered);
    return { delivered: noticeDelivered && promptDelivered };
  }
  if (next === "witness") {
    const delivered = await sendWitnessPrompt(deps.filingDetailsSenderDeps, sendInput);
    await finalizeOutbound(deps, commit.outboundIds[0], delivered);
    return { delivered };
  }
  if (next === "part-payment") {
    // Unreachable: serviceDate is the only field whose `next` is
    // "part-payment" (see NEXT_FIELD above), and that's always handled by
    // the field === "serviceDate" branch above. Kept only so TS can narrow
    // `next` to TextFieldKey for the PROMPT_TEXT lookup below.
    const delivered = await sendPartPaymentPrompt(deps.filingDetailsSenderDeps, sendInput);
    await finalizeOutbound(deps, commit.outboundIds[0], delivered);
    return { delivered };
  }

  const delivered = await sendFilingPlainText(deps, sendInput, PROMPT_TEXT[next][input.language], `filing_details_${next}_prompt_send_failed`);
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

export function handleFilingChequeNumberInput(deps: FilingDetailsWorkflowDeps, input: FilingDetailsFieldInputEvent): Promise<FilingWorkflowResult> {
  return handleTextFieldInput(deps, "chequeNumber", input);
}
export function handleFilingChequeDateInput(deps: FilingDetailsWorkflowDeps, input: FilingDetailsFieldInputEvent): Promise<FilingWorkflowResult> {
  return handleTextFieldInput(deps, "chequeDate", input);
}
export function handleFilingAmountInput(deps: FilingDetailsWorkflowDeps, input: FilingDetailsFieldInputEvent): Promise<FilingWorkflowResult> {
  return handleTextFieldInput(deps, "amount", input);
}
export function handleFilingBankBranchInput(deps: FilingDetailsWorkflowDeps, input: FilingDetailsFieldInputEvent): Promise<FilingWorkflowResult> {
  return handleTextFieldInput(deps, "bankBranch", input);
}
export function handleFilingMemoDateInput(deps: FilingDetailsWorkflowDeps, input: FilingDetailsFieldInputEvent): Promise<FilingWorkflowResult> {
  return handleTextFieldInput(deps, "memoDate", input);
}
export function handleFilingNoticeDateInput(deps: FilingDetailsWorkflowDeps, input: FilingDetailsFieldInputEvent): Promise<FilingWorkflowResult> {
  return handleTextFieldInput(deps, "noticeDate", input);
}
export function handleFilingServiceDateInput(deps: FilingDetailsWorkflowDeps, input: FilingDetailsFieldInputEvent): Promise<FilingWorkflowResult> {
  return handleTextFieldInput(deps, "serviceDate", input);
}
export function handleFilingStoryInput(deps: FilingDetailsWorkflowDeps, input: FilingDetailsFieldInputEvent): Promise<FilingWorkflowResult> {
  return handleTextFieldInput(deps, "story", input);
}

/**
 * Sends the cheque-number prompt on its own — used by accused-workflow.ts's
 * confirmAccused to cascade straight from ACCUSED_CONFIRM into
 * FILING_CHEQUE_NUMBER_PENDING (#33 Part C), which only needs the minimal
 * messaging shape, not the rest of FilingDetailsWorkflowDeps.
 */
export function sendFilingChequeNumberPrompt(deps: { messagingClient: FilingDetailsWorkflowDeps["messagingClient"]; fromNumber: string }, input: SendFilingDetailsMessageInput): Promise<boolean> {
  return sendFilingPlainText(deps, input, PROMPT_TEXT.chequeNumber[input.language], "filing_cheque_number_prompt_send_failed");
}

// ---------------------------------------------------------------------------
// Return reason (optional 4-option select, or Skip) — bespoke: a selection,
// not free text, and always advances to memoDate regardless of the answer.
// ---------------------------------------------------------------------------

export async function handleFilingReturnReasonInput(deps: FilingDetailsWorkflowDeps, input: FilingDetailsActionInput): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);
  const reason = parseReturnReasonSelection(input.selection);
  // A stable ID (button tap) is only ever the reason itself or unrecognized
  // — never a fallback into Skip-checking, same stable-ID-authoritative
  // rule as every parser in this codebase. Skip only applies to a typed
  // reply with no stable ID at all.
  const hasStableId = Boolean(input.selection.buttonPayload || input.selection.listId);
  const skipped = !reason && !hasStableId && isSkipSelection(input.selection);

  if (!reason && !skipped) {
    return { delivered: await sendReturnReasonPrompt(deps.filingDetailsSenderDeps, sendInput) };
  }

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_RETURN_REASON_PENDING") {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }

    if (reason) {
      await deps.filingRepo.upsertFilingFields(tx, filing.id, { returnReason: reason });
    }
    await deps.filingRepo.setCurrentStep(tx, filing.id, "FILING_MEMO_DATE_PENDING");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_MEMO_DATE_PENDING");
    return { committed: true, sends: [{ messageType: "FILING_MEMO_DATE_PROMPT" as const, dedupeSuffix: "memo-date-prompt" }] };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const delivered = await sendFilingPlainText(deps, sendInput, PROMPT_TEXT.memoDate[input.language], "filing_details_memoDate_prompt_send_failed");
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

// ---------------------------------------------------------------------------
// Paid after notice? (required 2-option radio) — bespoke: always advances
// to the narrative (Part D).
// ---------------------------------------------------------------------------

export async function handleFilingPartPaymentInput(deps: FilingDetailsWorkflowDeps, input: FilingDetailsActionInput): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);
  const partPayment = parsePartPaymentSelection(input.selection);

  if (partPayment === null) {
    return { delivered: await sendPartPaymentPrompt(deps.filingDetailsSenderDeps, sendInput) };
  }

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_PART_PAYMENT_PENDING") {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }

    await deps.filingRepo.upsertFilingFields(tx, filing.id, { partPayment });
    await deps.filingRepo.setCurrentStep(tx, filing.id, "FILING_STORY_PENDING");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_STORY_PENDING");
    return { committed: true, sends: [{ messageType: "FILING_STORY_PROMPT" as const, dedupeSuffix: "story-prompt" }] };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const delivered = await sendFilingPlainText(deps, sendInput, PROMPT_TEXT.story[input.language], "filing_details_story_prompt_send_failed");
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

// ---------------------------------------------------------------------------
// Witness (required 2-option radio) — bespoke: always cascades into #33
// Part E's entry point (the optional written-account upload), the last
// step this file owns.
// ---------------------------------------------------------------------------

export async function handleFilingWitnessInput(deps: FilingDetailsWorkflowDeps, input: FilingDetailsActionInput): Promise<FilingWorkflowResult> {
  const sendInput = sendInputFor(input);
  const witnessPresent = parseWitnessSelection(input.selection);

  if (witnessPresent === null) {
    return { delivered: await sendWitnessPrompt(deps.filingDetailsSenderDeps, sendInput) };
  }

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "FILING_WITNESS_PENDING") {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }

    await deps.filingRepo.upsertFilingFields(tx, filing.id, { witnessPresent });
    await deps.filingRepo.setCurrentStep(tx, filing.id, "FILING_WRITTEN_ACCOUNT_PENDING");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_WRITTEN_ACCOUNT_PENDING");
    return { committed: true, sends: [{ messageType: "FILING_WRITTEN_ACCOUNT_PROMPT" as const, dedupeSuffix: "written-account-prompt" }] };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const delivered = await handleFilingWrittenAccountEntry(deps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

// ---------------------------------------------------------------------------
// Resume support for #8's filing-workflow.ts.
// ---------------------------------------------------------------------------

/** Resends whatever the advocate should see for a draft resumed into one of Parts C/D's steps — the exact pending field prompt or selection template. Read-only: never mutates anything. */
export async function resendFilingDetailsPromptForResume(
  deps: { filingDetailsSenderDeps: FilingDetailsSenderDeps; messagingClient: FilingDetailsWorkflowDeps["messagingClient"]; fromNumber: string },
  currentStep: string,
  sendInput: SendFilingDetailsMessageInput,
): Promise<boolean> {
  if (currentStep === "FILING_RETURN_REASON_PENDING") {
    return sendReturnReasonPrompt(deps.filingDetailsSenderDeps, sendInput);
  }
  if (currentStep === "FILING_PART_PAYMENT_PENDING") {
    return sendPartPaymentPrompt(deps.filingDetailsSenderDeps, sendInput);
  }
  if (currentStep === "FILING_WITNESS_PENDING") {
    return sendWitnessPrompt(deps.filingDetailsSenderDeps, sendInput);
  }

  const field = RESUMABLE_STEP_TO_FIELD[currentStep];
  if (field) {
    return sendFilingPlainText(deps, sendInput, PROMPT_TEXT[field][sendInput.language], `filing_details_${field}_resume_prompt_send_failed`);
  }

  // Unreachable given filing-workflow.ts only calls this for steps in FILING_DETAILS_SUPPORTED_FILING_STEPS.
  return false;
}
