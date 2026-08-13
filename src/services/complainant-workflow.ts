import {
  parseComplainantConfirmAction,
  parseComplainantEditFieldAction,
  validateAddress,
  validateEmail,
  validatePersonName,
  validatePhoneNumber,
  type ComplainantEditFieldAction,
  type ComplainantSelectionInput,
} from "../domain/complainant";
import type { ConversationRepository, ConversationState } from "../repositories/conversation-repository";
import type { FilingRecord, FilingRepository } from "../repositories/filing-repository";
import type { FilingPartyRecord, FilingPartyRepository, UpsertFilingPartyFieldsInput } from "../repositories/filing-party-repository";
import type { OutboundMessageRepository, OutboundMessageType } from "../repositories/outbound-message-repository";
import type { RepositoryTransaction } from "../repositories/transaction";
import {
  sendComplainantEditFields,
  sendComplainantReviewActions,
  sendComplainantSummary,
  type ComplainantSenderDeps,
  type SendComplainantMessageInput,
} from "./complainant-sender";
import { sendFilingPlainText } from "./filing-sender";
import { sendMainMenu, type MainMenuSenderDeps, type SupportedLanguage } from "./main-menu-sender";
import { commitWithOutbound, finalizeOutbound } from "./transactional-outbound";

/**
 * Implements #10 (V6A) Parts G-L: collecting, validating, reviewing,
 * editing, and confirming the complainant's details. Field prompts/errors
 * have no Content Template (Part D) and are sent with the generic
 * `sendFilingPlainText` helper reused from filing-sender.ts; the two rich
 * templates (review-actions, edit-fields) live in complainant-sender.ts.
 *
 * This file must never import from filing-workflow.ts — filing-workflow.ts
 * imports `resendComplainantPromptForResume` from here (for #8's draft
 * resume), so the dependency only ever runs one way.
 */

export interface ComplainantWorkflowDeps {
  conversationRepo: ConversationRepository;
  filingRepo: FilingRepository;
  partyRepo: FilingPartyRepository;
  /** Durable outbound intent, enqueued inside the same transaction as each committed state change — see commitWithOutbound in transactional-outbound.ts. */
  outboundMessageRepo: OutboundMessageRepository;
  complainantSenderDeps: ComplainantSenderDeps;
  /** Reused as-is for "back to main menu" after save-and-exit — never a second implementation. */
  mainMenuSenderDeps: MainMenuSenderDeps;
  withTransaction: <T>(fn: (tx: RepositoryTransaction) => Promise<T>) => Promise<T>;
}

export interface ComplainantWorkflowResult {
  delivered: boolean;
}

export interface ComplainantFieldInputEvent {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
  text: string;
  /** Number of media attachments on the inbound message — media-only input is rejected the same as any other invalid input (#10 Part G, mirroring #9 Part F). */
  mediaCount: number;
}

export interface ComplainantActionInput {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
  selection: ComplainantSelectionInput;
}

type FieldKey = "name" | "phone" | "email" | "address";

function sendInputFor(input: { whatsappNumber: string; language: SupportedLanguage; messageId: string }): SendComplainantMessageInput {
  return { to: input.whatsappNumber, language: input.language, correlationId: input.messageId };
}

// ---------------------------------------------------------------------------
// Field copy (Part D) — plain, in-session messages; no Content Template.
// ---------------------------------------------------------------------------

const PROMPT_TEXT: Record<FieldKey, Record<SupportedLanguage, string>> = {
  name: {
    en: "Enter the complainant's full name.",
    ml: "പരാതിക്കാരന്റെ പൂർണ്ണ പേര് നൽകുക.",
  },
  phone: {
    en: [
      "Enter the complainant's phone number, including the country code if available.",
      "",
      "Example: +91 98765 43210",
      "",
      "The number will be recorded but not verified.",
    ].join("\n"),
    ml: [
      "പരാതിക്കാരന്റെ ഫോൺ നമ്പർ നൽകുക, ലഭ്യമെങ്കിൽ കൺട്രി കോഡ് ഉൾപ്പെടെ.",
      "",
      "ഉദാഹരണം: +91 98765 43210",
      "",
      "ഈ നമ്പർ രേഖപ്പെടുത്തും, പക്ഷേ പരിശോധിക്കില്ല.",
    ].join("\n"),
  },
  email: {
    en: ["Enter the complainant's email address.", "", "If there is no email address, reply Skip."].join("\n"),
    ml: ["പരാതിക്കാരന്റെ ഇമെയിൽ വിലാസം നൽകുക.", "", "ഇമെയിൽ വിലാസം ഇല്ലെങ്കിൽ, ഒഴിവാക്കുക എന്ന് മറുപടി നൽകുക."].join("\n"),
  },
  address: {
    en: ["Enter the complainant's complete address in one message.", "", "You may use multiple lines."].join("\n"),
    ml: ["പരാതിക്കാരന്റെ പൂർണ്ണ വിലാസം ഒറ്റ സന്ദേശത്തിൽ നൽകുക.", "", "ഒന്നിലധികം വരികൾ ഉപയോഗിക്കാം."].join("\n"),
  },
};

const ERROR_TEXT: Record<FieldKey, Record<SupportedLanguage, string>> = {
  name: {
    en: ["That name doesn't look valid.", "", "Enter 2–120 characters, without line breaks.", "", "Example: Anitha Joseph"].join("\n"),
    ml: [
      "ആ പേര് സാധുവായി തോന്നുന്നില്ല.",
      "",
      "വരി മുറിവുകൾ ഇല്ലാതെ 2–120 അക്ഷരങ്ങൾ നൽകുക.",
      "",
      "ഉദാഹരണം: അനിത ജോസഫ്",
    ].join("\n"),
  },
  phone: {
    en: [
      "That phone number does not appear to be valid.",
      "",
      "Enter a 10-digit Indian mobile number, or include the country code.",
      "",
      "Example: +91 98765 43210",
    ].join("\n"),
    ml: [
      "ആ ഫോൺ നമ്പർ സാധുവായി തോന്നുന്നില്ല.",
      "",
      "10 അക്കമുള്ള ഇന്ത്യൻ മൊബൈൽ നമ്പർ നൽകുക, അല്ലെങ്കിൽ കൺട്രി കോഡ് ഉൾപ്പെടുത്തുക.",
      "",
      "ഉദാഹരണം: +91 98765 43210",
    ].join("\n"),
  },
  email: {
    en: [
      "That email address does not appear to be valid.",
      "",
      "Enter a valid email address, or reply Skip if there is none.",
      "",
      "Example: anitha@example.com",
    ].join("\n"),
    ml: [
      "ആ ഇമെയിൽ വിലാസം സാധുവായി തോന്നുന്നില്ല.",
      "",
      "സാധുവായ ഇമെയിൽ വിലാസം നൽകുക, അല്ലെങ്കിൽ ഇല്ലെങ്കിൽ ഒഴിവാക്കുക എന്ന് മറുപടി നൽകുക.",
      "",
      "ഉദാഹരണം: anitha@example.com",
    ].join("\n"),
  },
  address: {
    en: [
      "That address does not appear to be valid.",
      "",
      "Enter 10–500 characters describing the complete address.",
      "",
      "You may use multiple lines.",
    ].join("\n"),
    ml: [
      "ആ വിലാസം സാധുവായി തോന്നുന്നില്ല.",
      "",
      "പൂർണ്ണ വിലാസം വിവരിക്കുന്ന 10–500 അക്ഷരങ്ങൾ നൽകുക.",
      "",
      "ഒന്നിലധികം വരികൾ ഉപയോഗിക്കാം.",
    ].join("\n"),
  },
};

const RECORDED_TEXT: Record<SupportedLanguage, string> = {
  en: "✓ Complainant details recorded.\n\nNext, we will collect the accused person's details.",
  ml: "✓ പരാതിക്കാരന്റെ വിവരങ്ങൾ രേഖപ്പെടുത്തി.\n\nഅടുത്തതായി, പ്രതിയുടെ വിവരങ്ങൾ ശേഖരിക്കും.",
};

// Same copy as enrolment-workflow.ts's SAVED_TEXT (#9 Part K) — kept as its
// own constant here rather than a shared import, matching how every other
// per-context "saved" message in this codebase is defined locally.
const SAVED_TEXT: Record<SupportedLanguage, string> = {
  en: "✓ Your filing draft has been saved. You can resume it from the main menu.",
  ml: "✓ നിങ്ങളുടെ ഫയലിംഗ് ഡ്രാഫ്റ്റ് സേവ് ചെയ്തു. നിങ്ങൾക്ക് പ്രധാന മെനുവിൽ നിന്ന് ഇത് തുടരാം.",
};

// ---------------------------------------------------------------------------
// Field <-> state/outbound-type/next-field wiring (Part A)
// ---------------------------------------------------------------------------

const PROMPT_OUTBOUND_TYPE: Record<FieldKey, OutboundMessageType> = {
  name: "COMPLAINANT_NAME_PROMPT",
  phone: "COMPLAINANT_PHONE_PROMPT",
  email: "COMPLAINANT_EMAIL_PROMPT",
  address: "COMPLAINANT_ADDRESS_PROMPT",
};

const LINEAR_PENDING_STATE: Record<FieldKey, ConversationState> = {
  name: "COMPLAINANT_NAME_PENDING",
  phone: "COMPLAINANT_PHONE_PENDING",
  email: "COMPLAINANT_EMAIL_PENDING",
  address: "COMPLAINANT_ADDRESS_PENDING",
};

const EDIT_PENDING_STATE: Record<FieldKey, ConversationState> = {
  name: "COMPLAINANT_EDIT_NAME_PENDING",
  phone: "COMPLAINANT_EDIT_PHONE_PENDING",
  email: "COMPLAINANT_EDIT_EMAIL_PENDING",
  address: "COMPLAINANT_EDIT_ADDRESS_PENDING",
};

const NEXT_FIELD: Record<FieldKey, FieldKey | "confirm"> = {
  name: "phone",
  phone: "email",
  email: "address",
  address: "confirm",
};

const EDIT_FIELD_ACTION_TO_FIELD: Record<ComplainantEditFieldAction, FieldKey> = {
  "complainant:edit-name": "name",
  "complainant:edit-phone": "phone",
  "complainant:edit-email": "email",
  "complainant:edit-address": "address",
};

// Resolves every currentStep this workflow ever resumes into a text prompt
// for (#10 Part K) — the two non-field steps (COMPLAINANT_CONFIRM,
// COMPLAINANT_EDIT_FIELD) are handled separately in
// `resendComplainantPromptForResume`, since they resend a template, not a
// plain-text field prompt. COMPLAINANT_DETAILS_START is kept only so any
// pre-existing row from #9 can still resume (see schema.ts).
const RESUMABLE_STEP_TO_FIELD: Partial<Record<string, FieldKey>> = {
  COMPLAINANT_DETAILS_START: "name",
  COMPLAINANT_NAME_PENDING: "name",
  COMPLAINANT_PHONE_PENDING: "phone",
  COMPLAINANT_EMAIL_PENDING: "email",
  COMPLAINANT_ADDRESS_PENDING: "address",
  COMPLAINANT_EDIT_NAME_PENDING: "name",
  COMPLAINANT_EDIT_PHONE_PENDING: "phone",
  COMPLAINANT_EDIT_EMAIL_PENDING: "email",
  COMPLAINANT_EDIT_ADDRESS_PENDING: "address",
};

/** Every currentStep #10 can resume into — combined with the enrolment set in filing-workflow.ts's SUPPORTED_FILING_STEPS. */
export const COMPLAINANT_SUPPORTED_FILING_STEPS: ReadonlySet<string> = new Set([
  "COMPLAINANT_DETAILS_START",
  "COMPLAINANT_NAME_PENDING",
  "COMPLAINANT_PHONE_PENDING",
  "COMPLAINANT_EMAIL_PENDING",
  "COMPLAINANT_ADDRESS_PENDING",
  "COMPLAINANT_CONFIRM",
  "COMPLAINANT_EDIT_FIELD",
  "COMPLAINANT_EDIT_NAME_PENDING",
  "COMPLAINANT_EDIT_PHONE_PENDING",
  "COMPLAINANT_EDIT_EMAIL_PENDING",
  "COMPLAINANT_EDIT_ADDRESS_PENDING",
]);

interface FieldValidationResult {
  valid: boolean;
  patch?: UpsertFilingPartyFieldsInput;
}

/** Dispatches to the field's own validator/normalizer and maps its result onto the filing_parties patch shape (#10 Part C). */
function validateField(field: FieldKey, text: string): FieldValidationResult {
  if (field === "name") {
    const result = validatePersonName(text);
    return result.valid && result.normalized ? { valid: true, patch: { fullName: result.normalized } } : { valid: false };
  }
  if (field === "phone") {
    const result = validatePhoneNumber(text);
    return result.valid && result.normalized
      ? { valid: true, patch: { phoneOriginal: result.original, phoneNormalized: result.normalized } }
      : { valid: false };
  }
  if (field === "email") {
    const result = validateEmail(text);
    return result.valid ? { valid: true, patch: { emailNormalized: result.normalized } } : { valid: false };
  }
  // address
  const result = validateAddress(text);
  return result.valid && result.normalized ? { valid: true, patch: { address: result.normalized } } : { valid: false };
}

async function sendValidationError(
  deps: ComplainantWorkflowDeps,
  sendInput: SendComplainantMessageInput,
  field: FieldKey,
): Promise<boolean> {
  return sendFilingPlainText(deps.complainantSenderDeps, sendInput, ERROR_TEXT[field][sendInput.language], `complainant_${field}_validation_error_send_failed`);
}

/** Reads the active draft's persisted complainant party fresh from the database — never from the current webhook body (#10 Part F/H). */
async function fetchParty(deps: ComplainantWorkflowDeps, filingId: string): Promise<FilingPartyRecord | null> {
  return deps.withTransaction((tx) => deps.partyRepo.findByFilingAndRole(tx, filingId, "COMPLAINANT"));
}

/** Read-only lookup of the active draft's party, for redisplaying the review screen on unrecognized input — never mutates anything. */
async function currentActiveParty(deps: ComplainantWorkflowDeps, conversationId: string): Promise<FilingPartyRecord | null> {
  return deps.withTransaction(async (tx) => {
    const filing = await deps.filingRepo.findActiveDraft(tx, conversationId);
    if (!filing) {
      return null;
    }
    return deps.partyRepo.findByFilingAndRole(tx, filing.id, "COMPLAINANT");
  });
}

async function sendSummaryAndReview(
  deps: ComplainantWorkflowDeps,
  sendInput: SendComplainantMessageInput,
  party: FilingPartyRecord,
): Promise<boolean> {
  const summaryDelivered = await sendComplainantSummary(deps.complainantSenderDeps, sendInput, party);
  const reviewDelivered = await sendComplainantReviewActions(deps.complainantSenderDeps, sendInput);
  return summaryDelivered && reviewDelivered;
}

// ---------------------------------------------------------------------------
// Linear field entry (Part G): COMPLAINANT_NAME_PENDING through
// COMPLAINANT_ADDRESS_PENDING, each advancing exactly one state.
// ---------------------------------------------------------------------------

async function handleLinearFieldInput(
  deps: ComplainantWorkflowDeps,
  field: FieldKey,
  input: ComplainantFieldInputEvent,
): Promise<ComplainantWorkflowResult> {
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
  const nextState: ConversationState = next === "confirm" ? "COMPLAINANT_CONFIRM" : LINEAR_PENDING_STATE[next];
  let filingIdRef: string | null = null;

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== LINEAR_PENDING_STATE[field]) {
      return { committed: false };
    }

    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    filingIdRef = filing.id;

    await deps.partyRepo.upsertFields(tx, filing.id, "COMPLAINANT", patch);
    await deps.filingRepo.setCurrentStep(tx, filing.id, nextState);
    await deps.conversationRepo.setStateInTx(tx, locked.id, nextState);

    if (next === "confirm") {
      return {
        committed: true,
        sends: [
          { messageType: "COMPLAINANT_SUMMARY" as const, dedupeSuffix: "complainant-summary" },
          { messageType: "COMPLAINANT_REVIEW_ACTIONS" as const, dedupeSuffix: "complainant-review-actions" },
        ],
      };
    }
    return { committed: true, sends: [{ messageType: PROMPT_OUTBOUND_TYPE[next], dedupeSuffix: `${next}-prompt` }] };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  if (next === "confirm") {
    const party = filingIdRef ? await fetchParty(deps, filingIdRef) : null;
    if (!party) {
      // Should never happen (we just wrote it) — but never crash on a
      // missing read; there is nothing meaningful left to send.
      return { delivered: true };
    }
    const summaryDelivered = await sendComplainantSummary(deps.complainantSenderDeps, sendInput, party);
    await finalizeOutbound(deps, commit.outboundIds[0], summaryDelivered);
    const reviewDelivered = await sendComplainantReviewActions(deps.complainantSenderDeps, sendInput);
    await finalizeOutbound(deps, commit.outboundIds[1], reviewDelivered);
    return { delivered: summaryDelivered && reviewDelivered };
  }

  const delivered = await sendFilingPlainText(
    deps.complainantSenderDeps,
    sendInput,
    PROMPT_TEXT[next][input.language],
    `complainant_${next}_prompt_send_failed`,
  );
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

export function handleComplainantNameInput(deps: ComplainantWorkflowDeps, input: ComplainantFieldInputEvent): Promise<ComplainantWorkflowResult> {
  return handleLinearFieldInput(deps, "name", input);
}

export function handleComplainantPhoneInput(deps: ComplainantWorkflowDeps, input: ComplainantFieldInputEvent): Promise<ComplainantWorkflowResult> {
  return handleLinearFieldInput(deps, "phone", input);
}

export function handleComplainantEmailInput(deps: ComplainantWorkflowDeps, input: ComplainantFieldInputEvent): Promise<ComplainantWorkflowResult> {
  return handleLinearFieldInput(deps, "email", input);
}

export function handleComplainantAddressInput(deps: ComplainantWorkflowDeps, input: ComplainantFieldInputEvent): Promise<ComplainantWorkflowResult> {
  return handleLinearFieldInput(deps, "address", input);
}

/**
 * Sends the name prompt on its own — used by enrolment-workflow.ts's
 * confirmEnrolment to cascade straight from ADVOCATE_ENROLMENT_CONFIRM into
 * COMPLAINANT_NAME_PENDING (#10 Part A), which only needs
 * `ComplainantSenderDeps`, not the rest of `ComplainantWorkflowDeps`. Kept
 * here as the one source of the name-prompt copy, rather than duplicating
 * `PROMPT_TEXT.name` in enrolment-workflow.ts.
 */
export function sendComplainantNamePrompt(deps: ComplainantSenderDeps, input: SendComplainantMessageInput): Promise<boolean> {
  return sendFilingPlainText(deps, input, PROMPT_TEXT.name[input.language], "complainant_name_prompt_send_failed");
}

// ---------------------------------------------------------------------------
// Edit-pending field input (Part I): validates and saves exactly one
// replacement value, then always returns to COMPLAINANT_CONFIRM.
// ---------------------------------------------------------------------------

async function handleEditFieldInput(
  deps: ComplainantWorkflowDeps,
  field: FieldKey,
  input: ComplainantFieldInputEvent,
): Promise<ComplainantWorkflowResult> {
  const sendInput = sendInputFor(input);

  if (input.mediaCount > 0 && !input.text.trim()) {
    return { delivered: await sendValidationError(deps, sendInput, field) };
  }

  const validation = validateField(field, input.text);
  if (!validation.valid || !validation.patch) {
    return { delivered: await sendValidationError(deps, sendInput, field) };
  }
  const patch = validation.patch;

  let filingIdRef: string | null = null;
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== EDIT_PENDING_STATE[field]) {
      return { committed: false };
    }

    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    filingIdRef = filing.id;

    // Only this one field is written — every other already-answered field
    // on the party row is left exactly as it was (#10 Part I).
    await deps.partyRepo.upsertFields(tx, filing.id, "COMPLAINANT", patch);
    await deps.filingRepo.setCurrentStep(tx, filing.id, "COMPLAINANT_CONFIRM");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "COMPLAINANT_CONFIRM");
    return {
      committed: true,
      sends: [
        { messageType: "COMPLAINANT_SUMMARY" as const, dedupeSuffix: "complainant-summary" },
        { messageType: "COMPLAINANT_REVIEW_ACTIONS" as const, dedupeSuffix: "complainant-review-actions" },
      ],
    };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const party = filingIdRef ? await fetchParty(deps, filingIdRef) : null;
  if (!party) {
    return { delivered: true };
  }
  const summaryDelivered = await sendComplainantSummary(deps.complainantSenderDeps, sendInput, party);
  await finalizeOutbound(deps, commit.outboundIds[0], summaryDelivered);
  const reviewDelivered = await sendComplainantReviewActions(deps.complainantSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[1], reviewDelivered);
  return { delivered: summaryDelivered && reviewDelivered };
}

export function handleComplainantEditNameInput(deps: ComplainantWorkflowDeps, input: ComplainantFieldInputEvent): Promise<ComplainantWorkflowResult> {
  return handleEditFieldInput(deps, "name", input);
}

export function handleComplainantEditPhoneInput(deps: ComplainantWorkflowDeps, input: ComplainantFieldInputEvent): Promise<ComplainantWorkflowResult> {
  return handleEditFieldInput(deps, "phone", input);
}

export function handleComplainantEditEmailInput(deps: ComplainantWorkflowDeps, input: ComplainantFieldInputEvent): Promise<ComplainantWorkflowResult> {
  return handleEditFieldInput(deps, "email", input);
}

export function handleComplainantEditAddressInput(deps: ComplainantWorkflowDeps, input: ComplainantFieldInputEvent): Promise<ComplainantWorkflowResult> {
  return handleEditFieldInput(deps, "address", input);
}

// ---------------------------------------------------------------------------
// Edit-field selection (Part I): COMPLAINANT_EDIT_FIELD list-picker dispatch.
// ---------------------------------------------------------------------------

export async function handleComplainantEditFieldSelection(
  deps: ComplainantWorkflowDeps,
  input: ComplainantActionInput,
): Promise<ComplainantWorkflowResult> {
  const action = parseComplainantEditFieldAction(input.selection);
  const sendInput = sendInputFor(input);

  if (!action) {
    return { delivered: await sendComplainantEditFields(deps.complainantSenderDeps, sendInput) };
  }

  const field = EDIT_FIELD_ACTION_TO_FIELD[action];
  const pendingState = EDIT_PENDING_STATE[field];

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "COMPLAINANT_EDIT_FIELD") {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }

    await deps.filingRepo.setCurrentStep(tx, filing.id, pendingState);
    await deps.conversationRepo.setStateInTx(tx, locked.id, pendingState);
    return { committed: true, sends: [{ messageType: PROMPT_OUTBOUND_TYPE[field], dedupeSuffix: `edit-${field}-prompt` }] };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const delivered = await sendFilingPlainText(
    deps.complainantSenderDeps,
    sendInput,
    PROMPT_TEXT[field][input.language],
    `complainant_edit_${field}_prompt_send_failed`,
  );
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

// ---------------------------------------------------------------------------
// COMPLAINANT_CONFIRM dispatch (Parts J/K): Confirm / Edit / Save and exit.
// ---------------------------------------------------------------------------

export async function handleComplainantConfirmInput(
  deps: ComplainantWorkflowDeps,
  input: ComplainantActionInput,
): Promise<ComplainantWorkflowResult> {
  const action = parseComplainantConfirmAction(input.selection);

  if (!action) {
    return redisplayConfirm(deps, input);
  }

  if (action === "complainant:confirm") {
    return confirmComplainant(deps, input);
  }

  if (action === "complainant:edit") {
    return openEditFieldPicker(deps, input);
  }

  // filing:save-exit
  return saveAndExitFromConfirm(deps, input);
}

async function redisplayConfirm(deps: ComplainantWorkflowDeps, input: ComplainantActionInput): Promise<ComplainantWorkflowResult> {
  const party = await currentActiveParty(deps, input.conversationId);
  if (!party) {
    // Nothing to redisplay (draft/party already gone) — safe no-op.
    return { delivered: true };
  }
  return { delivered: await sendSummaryAndReview(deps, sendInputFor(input), party) };
}

async function confirmComplainant(deps: ComplainantWorkflowDeps, input: ComplainantActionInput): Promise<ComplainantWorkflowResult> {
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "COMPLAINANT_CONFIRM") {
      return { committed: false };
    }

    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }

    // #10 Part N: lock the filing itself too, so a concurrent Confirm/Edit
    // on the same filing serializes — only the first valid transition wins
    // (mirrors #9 Part K).
    const lockedFiling = await deps.filingRepo.lockById(tx, filing.id);
    if (lockedFiling.currentStep !== "COMPLAINANT_CONFIRM") {
      return { committed: false };
    }

    const party = await deps.partyRepo.findByFilingAndRole(tx, lockedFiling.id, "COMPLAINANT");
    // #10 Part J: valid only with full name, phone, and address present
    // (each already format-validated on entry) and email valid-or-null.
    if (!party || !party.fullName || !party.phoneNormalized || !party.address) {
      return { committed: false };
    }

    await deps.partyRepo.confirm(tx, lockedFiling.id, "COMPLAINANT", new Date());
    await deps.filingRepo.setCurrentStep(tx, lockedFiling.id, "ACCUSED_DETAILS_START");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "ACCUSED_DETAILS_START");
    return { committed: true, sends: [{ messageType: "COMPLAINANT_RECORDED" as const, dedupeSuffix: "complainant-recorded" }] };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const delivered = await sendFilingPlainText(
    deps.complainantSenderDeps,
    sendInputFor(input),
    RECORDED_TEXT[input.language],
    "complainant_recorded_send_failed",
  );
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

async function openEditFieldPicker(deps: ComplainantWorkflowDeps, input: ComplainantActionInput): Promise<ComplainantWorkflowResult> {
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "COMPLAINANT_CONFIRM") {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    // Serialize against a concurrent Confirm on the same filing (#10 Part N).
    const lockedFiling = await deps.filingRepo.lockById(tx, filing.id);
    if (lockedFiling.currentStep !== "COMPLAINANT_CONFIRM") {
      return { committed: false };
    }

    await deps.filingRepo.setCurrentStep(tx, lockedFiling.id, "COMPLAINANT_EDIT_FIELD");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "COMPLAINANT_EDIT_FIELD");
    return { committed: true, sends: [{ messageType: "COMPLAINANT_EDIT_FIELDS" as const, dedupeSuffix: "complainant-edit-fields" }] };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const delivered = await sendComplainantEditFields(deps.complainantSenderDeps, sendInputFor(input));
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

async function saveAndExitFromConfirm(deps: ComplainantWorkflowDeps, input: ComplainantActionInput): Promise<ComplainantWorkflowResult> {
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "COMPLAINANT_CONFIRM") {
      return { committed: false };
    }
    // Part K: keep party status DRAFT, filing.current_step
    // COMPLAINANT_CONFIRM, and active_filing_id exactly as-is — only the
    // conversation moves.
    await deps.conversationRepo.setStateInTx(tx, locked.id, "MAIN_MENU");
    return {
      committed: true,
      sends: [
        { messageType: "FILING_SAVED" as const, dedupeSuffix: "filing-saved" },
        { messageType: "MAIN_MENU" as const, dedupeSuffix: "main-menu" },
      ],
    };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const sendInput = sendInputFor(input);
  const savedDelivered = await sendFilingPlainText(deps.complainantSenderDeps, sendInput, SAVED_TEXT[input.language], "filing_saved_send_failed");
  await finalizeOutbound(deps, commit.outboundIds[0], savedDelivered);

  const menuDelivered = await sendMainMenu(deps.mainMenuSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[1], menuDelivered);

  return { delivered: savedDelivered && menuDelivered };
}

// ---------------------------------------------------------------------------
// Resume support for #8's filing-workflow.ts (Part K).
// ---------------------------------------------------------------------------

/**
 * Resends whatever the advocate should see for a draft resumed into one of
 * #10's steps — the exact pending field prompt, the edit-field picker, or
 * the full summary + review actions at COMPLAINANT_CONFIRM. Read-only:
 * never mutates the filing/party/conversation itself (the caller in
 * filing-workflow.ts has already restored the conversation's state).
 */
export async function resendComplainantPromptForResume(
  deps: ComplainantWorkflowDeps,
  filing: FilingRecord,
  sendInput: SendComplainantMessageInput,
): Promise<boolean> {
  if (filing.currentStep === "COMPLAINANT_CONFIRM") {
    const party = await fetchParty(deps, filing.id);
    if (!party) {
      // Nothing to resend (party row missing) — safe no-op, mirrors #9's
      // null-candidate no-op in enrolment-workflow.ts.
      return true;
    }
    return sendSummaryAndReview(deps, sendInput, party);
  }

  if (filing.currentStep === "COMPLAINANT_EDIT_FIELD") {
    return sendComplainantEditFields(deps.complainantSenderDeps, sendInput);
  }

  const field = RESUMABLE_STEP_TO_FIELD[filing.currentStep];
  if (field) {
    return sendFilingPlainText(
      deps.complainantSenderDeps,
      sendInput,
      PROMPT_TEXT[field][sendInput.language],
      `complainant_${field}_resume_prompt_send_failed`,
    );
  }

  // Unreachable given filing-workflow.ts only calls this for steps in
  // COMPLAINANT_SUPPORTED_FILING_STEPS.
  return false;
}
