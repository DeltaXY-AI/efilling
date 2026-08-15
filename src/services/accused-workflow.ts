import {
  parseAccusedConfirmAction,
  parseAccusedEditFieldAction,
  parseEntityTypeSelection,
  validateAccusedPhone,
  type AccusedEditFieldAction,
  type AccusedSelectionInput,
} from "../domain/accused";
import { validateAddress, validatePersonName } from "../domain/complainant";
import { sendFilingChequeNumberPrompt } from "./filing-details-workflow";
import type { ConversationRepository, ConversationState } from "../repositories/conversation-repository";
import type { FilingRecord, FilingRepository } from "../repositories/filing-repository";
import type { FilingPartyRecord, FilingPartyRepository, UpsertFilingPartyFieldsInput } from "../repositories/filing-party-repository";
import type { OutboundMessageRepository, OutboundMessageType } from "../repositories/outbound-message-repository";
import type { RepositoryTransaction } from "../repositories/transaction";
import {
  sendAccusedEditFields,
  sendAccusedEntityTypePrompt,
  sendAccusedReviewActions,
  sendAccusedSummary,
  type AccusedSenderDeps,
  type SendAccusedMessageInput,
} from "./accused-sender";
import { sendFilingPlainText } from "./filing-sender";
import { sendMainMenu, type MainMenuSenderDeps, type SupportedLanguage } from "./main-menu-sender";
import { commitWithOutbound, finalizeOutbound } from "./transactional-outbound";

/**
 * Implements #11 (V6B) Parts G-K: collecting, validating, reviewing,
 * editing, and confirming the accused party's details. Mirrors
 * complainant-workflow.ts's structure closely (#10), minus the email field
 * (accused has none) and with phone optional/Skip-able instead of required.
 * Full name/address validation is reused unchanged from ../domain/complainant.ts
 * (#11 Part C: "do not fork or duplicate validation behaviour").
 *
 * This file must never import from filing-workflow.ts — filing-workflow.ts
 * imports `resendAccusedPromptForResume` from here (for #8's draft resume),
 * so the dependency only ever runs one way.
 */

export interface AccusedWorkflowDeps {
  conversationRepo: ConversationRepository;
  filingRepo: FilingRepository;
  partyRepo: FilingPartyRepository;
  /** Durable outbound intent, enqueued inside the same transaction as each committed state change — see commitWithOutbound in transactional-outbound.ts. */
  outboundMessageRepo: OutboundMessageRepository;
  accusedSenderDeps: AccusedSenderDeps;
  /** Reused as-is for "back to main menu" after save-and-exit — never a second implementation. */
  mainMenuSenderDeps: MainMenuSenderDeps;
  withTransaction: <T>(fn: (tx: RepositoryTransaction) => Promise<T>) => Promise<T>;
}

export interface AccusedWorkflowResult {
  delivered: boolean;
}

export interface AccusedFieldInputEvent {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
  text: string;
  /** Number of media attachments on the inbound message — media-only input is rejected the same as any other invalid input (#11 Part G, mirroring #10 Part G). */
  mediaCount: number;
}

export interface AccusedActionInput {
  conversationId: string;
  whatsappNumber: string;
  messageId: string;
  language: SupportedLanguage;
  selection: AccusedSelectionInput;
}

type FieldKey = "name" | "phone" | "address";

function sendInputFor(input: { whatsappNumber: string; language: SupportedLanguage; messageId: string }): SendAccusedMessageInput {
  return { to: input.whatsappNumber, language: input.language, correlationId: input.messageId };
}

// ---------------------------------------------------------------------------
// Field copy (Part D) — plain, in-session messages; no Content Template.
// ---------------------------------------------------------------------------

const PROMPT_TEXT: Record<FieldKey, Record<SupportedLanguage, string>> = {
  name: {
    en: "Enter the accused person's full or legal name.",
    ml: "എതിർകക്ഷിയുടെ പൂർണ്ണമായോ നിയമപരമായോ പേര് നൽകുക.",
  },
  phone: {
    en: [
      "Enter the accused person's phone number, including the country code if available.",
      "",
      "If the number is not available, reply Skip.",
      "",
      "The number will be recorded but not verified or contacted.",
    ].join("\n"),
    ml: [
      "എതിർകക്ഷിയുടെ ഫോൺ നമ്പർ നൽകുക, ലഭ്യമെങ്കിൽ കൺട്രി കോഡ് ഉൾപ്പെടെ.",
      "",
      "നമ്പർ ലഭ്യമല്ലെങ്കിൽ, ഒഴിവാക്കുക എന്ന് മറുപടി നൽകുക.",
      "",
      "ഈ നമ്പർ രേഖപ്പെടുത്തും, പക്ഷേ പരിശോധിക്കുകയോ ബന്ധപ്പെടുകയോ ഇല്ല.",
    ].join("\n"),
  },
  address: {
    en: [
      "Enter the accused person's complete address in one message.",
      "",
      "You may use multiple lines. The address will be recorded but not verified.",
    ].join("\n"),
    ml: [
      "എതിർകക്ഷിയുടെ പൂർണ്ണ വിലാസം ഒറ്റ സന്ദേശത്തിൽ നൽകുക.",
      "",
      "ഒന്നിലധികം വരികൾ ഉപയോഗിക്കാം. വിലാസം രേഖപ്പെടുത്തും, പക്ഷേ പരിശോധിക്കില്ല.",
    ].join("\n"),
  },
};

const ERROR_TEXT: Record<FieldKey, Record<SupportedLanguage, string>> = {
  name: {
    en: ["That name doesn't look valid.", "", "Enter 2–120 characters, without line breaks.", "", "Example: Rajesh Menon"].join("\n"),
    ml: [
      "ആ പേര് സാധുവായി തോന്നുന്നില്ല.",
      "",
      "വരി മുറിവുകൾ ഇല്ലാതെ 2–120 അക്ഷരങ്ങൾ നൽകുക.",
      "",
      "ഉദാഹരണം: രാജേഷ് മേനോൻ",
    ].join("\n"),
  },
  phone: {
    en: [
      "That phone number does not appear to be valid.",
      "",
      "Enter a 10-digit Indian mobile number, include the country code, or reply Skip if it's not available.",
      "",
      "Example: +91 98765 43210",
    ].join("\n"),
    ml: [
      "ആ ഫോൺ നമ്പർ സാധുവായി തോന്നുന്നില്ല.",
      "",
      "10 അക്കമുള്ള ഇന്ത്യൻ മൊബൈൽ നമ്പർ നൽകുക, കൺട്രി കോഡ് ഉൾപ്പെടുത്തുക, അല്ലെങ്കിൽ ലഭ്യമല്ലെങ്കിൽ ഒഴിവാക്കുക എന്ന് മറുപടി നൽകുക.",
      "",
      "ഉദാഹരണം: +91 98765 43210",
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
  en: [
    "✓ Accused party details recorded.",
    "",
    "The details have not been independently verified and no message has been sent to the accused.",
    "",
    "Next, we will collect the cheque details.",
  ].join("\n"),
  ml: [
    "✓ എതിർകക്ഷിയുടെ വിവരങ്ങൾ രേഖപ്പെടുത്തി.",
    "",
    "ഈ വിവരങ്ങൾ സ്വതന്ത്രമായി പരിശോധിച്ചിട്ടില്ല, എതിർകക്ഷിക്ക് ഒരു സന്ദേശവും അയച്ചിട്ടില്ല.",
    "",
    "അടുത്തതായി, ചെക്ക് വിവരങ്ങൾ ശേഖരിക്കും.",
  ].join("\n"),
};

// Same copy as complainant-workflow.ts's SAVED_TEXT (#10 Part K) — kept as
// its own constant here rather than a shared import, matching how every
// other per-context "saved" message in this codebase is defined locally.
const SAVED_TEXT: Record<SupportedLanguage, string> = {
  en: "✓ Your filing draft has been saved. You can resume it from the main menu.",
  ml: "✓ നിങ്ങളുടെ ഫയലിംഗ് ഡ്രാഫ്റ്റ് സേവ് ചെയ്തു. നിങ്ങൾക്ക് പ്രധാന മെനുവിൽ നിന്ന് ഇത് തുടരാം.",
};

// ---------------------------------------------------------------------------
// Field <-> state/outbound-type/next-field wiring (Part A)
// ---------------------------------------------------------------------------

const PROMPT_OUTBOUND_TYPE: Record<FieldKey, OutboundMessageType> = {
  name: "ACCUSED_NAME_PROMPT",
  phone: "ACCUSED_PHONE_PROMPT",
  address: "ACCUSED_ADDRESS_PROMPT",
};

const LINEAR_PENDING_STATE: Record<FieldKey, ConversationState> = {
  name: "ACCUSED_NAME_PENDING",
  phone: "ACCUSED_PHONE_PENDING",
  address: "ACCUSED_ADDRESS_PENDING",
};

const EDIT_PENDING_STATE: Record<FieldKey, ConversationState> = {
  name: "ACCUSED_EDIT_NAME_PENDING",
  phone: "ACCUSED_EDIT_PHONE_PENDING",
  address: "ACCUSED_EDIT_ADDRESS_PENDING",
};

// #33 Part B: `address`'s next is now the new entity-type field, not
// confirm directly — a selection, not free text (see
// handleAccusedEntityTypeInput), so it's a sentinel like "confirm" rather
// than a real FieldKey.
const NEXT_FIELD: Record<FieldKey, FieldKey | "confirm" | "entity-type"> = {
  name: "phone",
  phone: "address",
  address: "entity-type",
};

const EDIT_FIELD_ACTION_TO_FIELD: Partial<Record<AccusedEditFieldAction, FieldKey>> = {
  "accused:edit-name": "name",
  "accused:edit-phone": "phone",
  "accused:edit-address": "address",
};

// Resolves every currentStep this workflow ever resumes into a text prompt
// for (#11 Part J) — the non-field steps (ACCUSED_CONFIRM,
// ACCUSED_EDIT_FIELD, and #33 Part B's ACCUSED_ENTITY_TYPE_PENDING/
// ACCUSED_EDIT_ENTITY_TYPE_PENDING) are handled separately in
// `resendAccusedPromptForResume`, since they resend a template, not a
// plain-text field prompt. ACCUSED_DETAILS_START is kept only so any
// pre-existing row from #10 can still resume (see schema.ts).
const RESUMABLE_STEP_TO_FIELD: Partial<Record<string, FieldKey>> = {
  ACCUSED_DETAILS_START: "name",
  ACCUSED_NAME_PENDING: "name",
  ACCUSED_PHONE_PENDING: "phone",
  ACCUSED_ADDRESS_PENDING: "address",
  ACCUSED_EDIT_NAME_PENDING: "name",
  ACCUSED_EDIT_PHONE_PENDING: "phone",
  ACCUSED_EDIT_ADDRESS_PENDING: "address",
};

/** Every currentStep #11 can resume into — combined with the other sets in filing-workflow.ts's SUPPORTED_FILING_STEPS. #33 Part B adds the entity-type field and its edit counterpart. */
export const ACCUSED_SUPPORTED_FILING_STEPS: ReadonlySet<string> = new Set([
  "ACCUSED_DETAILS_START",
  "ACCUSED_NAME_PENDING",
  "ACCUSED_PHONE_PENDING",
  "ACCUSED_ADDRESS_PENDING",
  "ACCUSED_ENTITY_TYPE_PENDING",
  "ACCUSED_CONFIRM",
  "ACCUSED_EDIT_FIELD",
  "ACCUSED_EDIT_NAME_PENDING",
  "ACCUSED_EDIT_PHONE_PENDING",
  "ACCUSED_EDIT_ADDRESS_PENDING",
  "ACCUSED_EDIT_ENTITY_TYPE_PENDING",
]);

interface FieldValidationResult {
  valid: boolean;
  patch?: UpsertFilingPartyFieldsInput;
}

/** Dispatches to the field's own validator/normalizer (reused from ../domain/complainant.ts where applicable) and maps its result onto the filing_parties patch shape (#11 Part C). */
function validateField(field: FieldKey, text: string): FieldValidationResult {
  if (field === "name") {
    const result = validatePersonName(text);
    return result.valid && result.normalized ? { valid: true, patch: { fullName: result.normalized } } : { valid: false };
  }
  if (field === "phone") {
    const result = validateAccusedPhone(text);
    return result.valid ? { valid: true, patch: { phoneOriginal: result.original, phoneNormalized: result.normalized } } : { valid: false };
  }
  // address
  const result = validateAddress(text);
  return result.valid && result.normalized ? { valid: true, patch: { address: result.normalized } } : { valid: false };
}

async function sendValidationError(deps: AccusedWorkflowDeps, sendInput: SendAccusedMessageInput, field: FieldKey): Promise<boolean> {
  return sendFilingPlainText(deps.accusedSenderDeps, sendInput, ERROR_TEXT[field][sendInput.language], `accused_${field}_validation_error_send_failed`);
}

/** Reads the active draft's persisted accused party fresh from the database — never from the current webhook body (#11 Part F/H). */
async function fetchParty(deps: AccusedWorkflowDeps, filingId: string): Promise<FilingPartyRecord | null> {
  return deps.withTransaction((tx) => deps.partyRepo.findByFilingAndRole(tx, filingId, "ACCUSED"));
}

/** Read-only lookup of the active draft's party, for redisplaying the review screen on unrecognized input — never mutates anything. */
async function currentActiveParty(deps: AccusedWorkflowDeps, conversationId: string): Promise<FilingPartyRecord | null> {
  return deps.withTransaction(async (tx) => {
    const filing = await deps.filingRepo.findActiveDraft(tx, conversationId);
    if (!filing) {
      return null;
    }
    return deps.partyRepo.findByFilingAndRole(tx, filing.id, "ACCUSED");
  });
}

async function sendSummaryAndReview(deps: AccusedWorkflowDeps, sendInput: SendAccusedMessageInput, party: FilingPartyRecord): Promise<boolean> {
  const summaryDelivered = await sendAccusedSummary(deps.accusedSenderDeps, sendInput, party);
  const reviewDelivered = await sendAccusedReviewActions(deps.accusedSenderDeps, sendInput);
  return summaryDelivered && reviewDelivered;
}

// ---------------------------------------------------------------------------
// Linear field entry (Part G): ACCUSED_NAME_PENDING through
// ACCUSED_ADDRESS_PENDING, each advancing exactly one state.
// ---------------------------------------------------------------------------

async function handleLinearFieldInput(deps: AccusedWorkflowDeps, field: FieldKey, input: AccusedFieldInputEvent): Promise<AccusedWorkflowResult> {
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
  const nextState: ConversationState = next === "confirm" ? "ACCUSED_CONFIRM" : next === "entity-type" ? "ACCUSED_ENTITY_TYPE_PENDING" : LINEAR_PENDING_STATE[next];
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

    await deps.partyRepo.upsertFields(tx, filing.id, "ACCUSED", patch);
    await deps.filingRepo.setCurrentStep(tx, filing.id, nextState);
    await deps.conversationRepo.setStateInTx(tx, locked.id, nextState);

    if (next === "confirm") {
      return {
        committed: true,
        sends: [
          { messageType: "ACCUSED_SUMMARY" as const, dedupeSuffix: "accused-summary" },
          { messageType: "ACCUSED_REVIEW_ACTIONS" as const, dedupeSuffix: "accused-review-actions" },
        ],
      };
    }
    if (next === "entity-type") {
      return { committed: true, sends: [{ messageType: "ACCUSED_ENTITY_TYPE_PROMPT" as const, dedupeSuffix: "entity-type-prompt" }] };
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
    const summaryDelivered = await sendAccusedSummary(deps.accusedSenderDeps, sendInput, party);
    await finalizeOutbound(deps, commit.outboundIds[0], summaryDelivered);
    const reviewDelivered = await sendAccusedReviewActions(deps.accusedSenderDeps, sendInput);
    await finalizeOutbound(deps, commit.outboundIds[1], reviewDelivered);
    return { delivered: summaryDelivered && reviewDelivered };
  }

  if (next === "entity-type") {
    const delivered = await sendAccusedEntityTypePrompt(deps.accusedSenderDeps, sendInput);
    await finalizeOutbound(deps, commit.outboundIds[0], delivered);
    return { delivered };
  }

  const delivered = await sendFilingPlainText(
    deps.accusedSenderDeps,
    sendInput,
    PROMPT_TEXT[next][input.language],
    `accused_${next}_prompt_send_failed`,
  );
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

export function handleAccusedNameInput(deps: AccusedWorkflowDeps, input: AccusedFieldInputEvent): Promise<AccusedWorkflowResult> {
  return handleLinearFieldInput(deps, "name", input);
}

export function handleAccusedPhoneInput(deps: AccusedWorkflowDeps, input: AccusedFieldInputEvent): Promise<AccusedWorkflowResult> {
  return handleLinearFieldInput(deps, "phone", input);
}

export function handleAccusedAddressInput(deps: AccusedWorkflowDeps, input: AccusedFieldInputEvent): Promise<AccusedWorkflowResult> {
  return handleLinearFieldInput(deps, "address", input);
}

/**
 * Sends the name prompt on its own — used by complainant-workflow.ts's
 * confirmComplainant to cascade straight from COMPLAINANT_CONFIRM into
 * ACCUSED_NAME_PENDING (#11 Part A), which only needs `AccusedSenderDeps`,
 * not the rest of `AccusedWorkflowDeps`. Kept here as the one source of the
 * name-prompt copy, rather than duplicating `PROMPT_TEXT.name` elsewhere.
 */
export function sendAccusedNamePrompt(deps: AccusedSenderDeps, input: SendAccusedMessageInput): Promise<boolean> {
  return sendFilingPlainText(deps, input, PROMPT_TEXT.name[input.language], "accused_name_prompt_send_failed");
}

// ---------------------------------------------------------------------------
// Entity type (#33 Part B) — a selection, not free text, so it cannot go
// through handleLinearFieldInput's text-validation pipeline. Unlike
// complainant's "Filing as" (#33 Part A), there is no conditional branching
// here: every value leads straight to ACCUSED_CONFIRM.
// ---------------------------------------------------------------------------

export async function handleAccusedEntityTypeInput(deps: AccusedWorkflowDeps, input: AccusedActionInput): Promise<AccusedWorkflowResult> {
  const sendInput = sendInputFor(input);
  const entityType = parseEntityTypeSelection(input.selection);

  if (!entityType) {
    return { delivered: await sendAccusedEntityTypePrompt(deps.accusedSenderDeps, sendInput) };
  }

  let filingIdRef: string | null = null;
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "ACCUSED_ENTITY_TYPE_PENDING") {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    filingIdRef = filing.id;

    await deps.partyRepo.upsertFields(tx, filing.id, "ACCUSED", { entityType });
    await deps.filingRepo.setCurrentStep(tx, filing.id, "ACCUSED_CONFIRM");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "ACCUSED_CONFIRM");
    return {
      committed: true,
      sends: [
        { messageType: "ACCUSED_SUMMARY" as const, dedupeSuffix: "accused-summary" },
        { messageType: "ACCUSED_REVIEW_ACTIONS" as const, dedupeSuffix: "accused-review-actions" },
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
  const summaryDelivered = await sendAccusedSummary(deps.accusedSenderDeps, sendInput, party);
  await finalizeOutbound(deps, commit.outboundIds[0], summaryDelivered);
  const reviewDelivered = await sendAccusedReviewActions(deps.accusedSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[1], reviewDelivered);
  return { delivered: summaryDelivered && reviewDelivered };
}

/** #33 Part B: editing entity type from the review screen — same "only this one field changes" guarantee as every other edit, always returns to ACCUSED_CONFIRM. */
export async function handleAccusedEditEntityTypeInput(deps: AccusedWorkflowDeps, input: AccusedActionInput): Promise<AccusedWorkflowResult> {
  const sendInput = sendInputFor(input);
  const entityType = parseEntityTypeSelection(input.selection);

  if (!entityType) {
    return { delivered: await sendAccusedEntityTypePrompt(deps.accusedSenderDeps, sendInput) };
  }

  let filingIdRef: string | null = null;
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "ACCUSED_EDIT_ENTITY_TYPE_PENDING") {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    filingIdRef = filing.id;

    await deps.partyRepo.upsertFields(tx, filing.id, "ACCUSED", { entityType });
    await deps.filingRepo.setCurrentStep(tx, filing.id, "ACCUSED_CONFIRM");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "ACCUSED_CONFIRM");
    return {
      committed: true,
      sends: [
        { messageType: "ACCUSED_SUMMARY" as const, dedupeSuffix: "accused-summary" },
        { messageType: "ACCUSED_REVIEW_ACTIONS" as const, dedupeSuffix: "accused-review-actions" },
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
  const summaryDelivered = await sendAccusedSummary(deps.accusedSenderDeps, sendInput, party);
  await finalizeOutbound(deps, commit.outboundIds[0], summaryDelivered);
  const reviewDelivered = await sendAccusedReviewActions(deps.accusedSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[1], reviewDelivered);
  return { delivered: summaryDelivered && reviewDelivered };
}

// ---------------------------------------------------------------------------
// Edit-pending field input (Part H): validates and saves exactly one
// replacement value, then always returns to ACCUSED_CONFIRM.
// ---------------------------------------------------------------------------

async function handleEditFieldInput(deps: AccusedWorkflowDeps, field: FieldKey, input: AccusedFieldInputEvent): Promise<AccusedWorkflowResult> {
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
    // on the party row is left exactly as it was (#11 Part H).
    await deps.partyRepo.upsertFields(tx, filing.id, "ACCUSED", patch);
    await deps.filingRepo.setCurrentStep(tx, filing.id, "ACCUSED_CONFIRM");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "ACCUSED_CONFIRM");
    return {
      committed: true,
      sends: [
        { messageType: "ACCUSED_SUMMARY" as const, dedupeSuffix: "accused-summary" },
        { messageType: "ACCUSED_REVIEW_ACTIONS" as const, dedupeSuffix: "accused-review-actions" },
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
  const summaryDelivered = await sendAccusedSummary(deps.accusedSenderDeps, sendInput, party);
  await finalizeOutbound(deps, commit.outboundIds[0], summaryDelivered);
  const reviewDelivered = await sendAccusedReviewActions(deps.accusedSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[1], reviewDelivered);
  return { delivered: summaryDelivered && reviewDelivered };
}

export function handleAccusedEditNameInput(deps: AccusedWorkflowDeps, input: AccusedFieldInputEvent): Promise<AccusedWorkflowResult> {
  return handleEditFieldInput(deps, "name", input);
}

export function handleAccusedEditPhoneInput(deps: AccusedWorkflowDeps, input: AccusedFieldInputEvent): Promise<AccusedWorkflowResult> {
  return handleEditFieldInput(deps, "phone", input);
}

export function handleAccusedEditAddressInput(deps: AccusedWorkflowDeps, input: AccusedFieldInputEvent): Promise<AccusedWorkflowResult> {
  return handleEditFieldInput(deps, "address", input);
}

// ---------------------------------------------------------------------------
// Edit-field selection (Part H): ACCUSED_EDIT_FIELD list-picker dispatch.
// ---------------------------------------------------------------------------

export async function handleAccusedEditFieldSelection(deps: AccusedWorkflowDeps, input: AccusedActionInput): Promise<AccusedWorkflowResult> {
  const action = parseAccusedEditFieldAction(input.selection);
  const sendInput = sendInputFor(input);

  if (!action) {
    return { delivered: await sendAccusedEditFields(deps.accusedSenderDeps, sendInput) };
  }

  // #33 Part B: entity type is a selection (template resend), not a
  // plain-text field prompt — handled separately from the generic table below.
  if (action === "accused:edit-entity-type") {
    return openEditEntityTypePrompt(deps, input);
  }

  const field = EDIT_FIELD_ACTION_TO_FIELD[action];
  if (!field) {
    // Unreachable: every AccusedEditFieldAction other than
    // "accused:edit-entity-type" (handled above) has an entry in this table.
    return { delivered: true };
  }
  const pendingState = EDIT_PENDING_STATE[field];

  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "ACCUSED_EDIT_FIELD") {
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
    deps.accusedSenderDeps,
    sendInput,
    PROMPT_TEXT[field][input.language],
    `accused_edit_${field}_prompt_send_failed`,
  );
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

/** #33 Part B: the "accused:edit-entity-type" branch of handleAccusedEditFieldSelection — sends the entity-type template (not plain text) once entering ACCUSED_EDIT_ENTITY_TYPE_PENDING. */
async function openEditEntityTypePrompt(deps: AccusedWorkflowDeps, input: AccusedActionInput): Promise<AccusedWorkflowResult> {
  const sendInput = sendInputFor(input);
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "ACCUSED_EDIT_FIELD") {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }

    await deps.filingRepo.setCurrentStep(tx, filing.id, "ACCUSED_EDIT_ENTITY_TYPE_PENDING");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "ACCUSED_EDIT_ENTITY_TYPE_PENDING");
    return { committed: true, sends: [{ messageType: "ACCUSED_ENTITY_TYPE_PROMPT" as const, dedupeSuffix: "edit-entity-type-prompt" }] };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const delivered = await sendAccusedEntityTypePrompt(deps.accusedSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

// ---------------------------------------------------------------------------
// ACCUSED_CONFIRM dispatch (Parts I/J): Confirm / Edit / Save and exit.
// ---------------------------------------------------------------------------

export async function handleAccusedConfirmInput(deps: AccusedWorkflowDeps, input: AccusedActionInput): Promise<AccusedWorkflowResult> {
  const action = parseAccusedConfirmAction(input.selection);

  if (!action) {
    return redisplayConfirm(deps, input);
  }

  if (action === "accused:confirm") {
    return confirmAccused(deps, input);
  }

  if (action === "accused:edit") {
    return openEditFieldPicker(deps, input);
  }

  // filing:save-exit
  return saveAndExitFromConfirm(deps, input);
}

async function redisplayConfirm(deps: AccusedWorkflowDeps, input: AccusedActionInput): Promise<AccusedWorkflowResult> {
  const party = await currentActiveParty(deps, input.conversationId);
  if (!party) {
    // Nothing to redisplay (draft/party already gone) — safe no-op.
    return { delivered: true };
  }
  return { delivered: await sendSummaryAndReview(deps, sendInputFor(input), party) };
}

async function confirmAccused(deps: AccusedWorkflowDeps, input: AccusedActionInput): Promise<AccusedWorkflowResult> {
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "ACCUSED_CONFIRM") {
      return { committed: false };
    }

    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }

    // #11 Part M: lock the filing itself too, so a concurrent Confirm/Edit
    // on the same filing serializes — only the first valid transition wins
    // (mirrors #10 Part N).
    const lockedFiling = await deps.filingRepo.lockById(tx, filing.id);
    if (lockedFiling.currentStep !== "ACCUSED_CONFIRM") {
      return { committed: false };
    }

    const party = await deps.partyRepo.findByFilingAndRole(tx, lockedFiling.id, "ACCUSED");
    // #11 Part I: valid only with full/legal name and address present (each
    // already format-validated on entry); phone is valid-or-null. #33 Part B
    // also requires entityType.
    if (!party || !party.fullName || !party.address || !party.entityType) {
      return { committed: false };
    }

    await deps.partyRepo.confirm(tx, lockedFiling.id, "ACCUSED", new Date());
    // #33 Part C: cascades straight into the cheque/notice screen's first
    // field, replacing the old CHEQUE_DETAILS_START placeholder — never left
    // resting at an intermediate state (mirrors #10/#11's own cascades).
    await deps.filingRepo.setCurrentStep(tx, lockedFiling.id, "FILING_CHEQUE_NUMBER_PENDING");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "FILING_CHEQUE_NUMBER_PENDING");
    return {
      committed: true,
      sends: [
        { messageType: "ACCUSED_RECORDED" as const, dedupeSuffix: "accused-recorded" },
        { messageType: "FILING_CHEQUE_NUMBER_PROMPT" as const, dedupeSuffix: "filing-cheque-number-prompt" },
      ],
    };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const sendInput = sendInputFor(input);
  const delivered = await sendFilingPlainText(deps.accusedSenderDeps, sendInput, RECORDED_TEXT[input.language], "accused_recorded_send_failed");
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);

  const chequePromptDelivered = await sendFilingChequeNumberPrompt(deps.accusedSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[1], chequePromptDelivered);

  return { delivered: delivered && chequePromptDelivered };
}

async function openEditFieldPicker(deps: AccusedWorkflowDeps, input: AccusedActionInput): Promise<AccusedWorkflowResult> {
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "ACCUSED_CONFIRM") {
      return { committed: false };
    }
    const filing = await deps.filingRepo.findActiveDraft(tx, locked.id);
    if (!filing) {
      return { committed: false };
    }
    // Serialize against a concurrent Confirm on the same filing (#11 Part M).
    const lockedFiling = await deps.filingRepo.lockById(tx, filing.id);
    if (lockedFiling.currentStep !== "ACCUSED_CONFIRM") {
      return { committed: false };
    }

    await deps.filingRepo.setCurrentStep(tx, lockedFiling.id, "ACCUSED_EDIT_FIELD");
    await deps.conversationRepo.setStateInTx(tx, locked.id, "ACCUSED_EDIT_FIELD");
    return { committed: true, sends: [{ messageType: "ACCUSED_EDIT_FIELDS" as const, dedupeSuffix: "accused-edit-fields" }] };
  });

  if (!commit.committed) {
    return { delivered: true };
  }

  const delivered = await sendAccusedEditFields(deps.accusedSenderDeps, sendInputFor(input));
  await finalizeOutbound(deps, commit.outboundIds[0], delivered);
  return { delivered };
}

async function saveAndExitFromConfirm(deps: AccusedWorkflowDeps, input: AccusedActionInput): Promise<AccusedWorkflowResult> {
  const commit = await commitWithOutbound(deps, input, async (tx, locked) => {
    if (locked.state !== "ACCUSED_CONFIRM") {
      return { committed: false };
    }
    // Part J: keep party status DRAFT, filing.current_step ACCUSED_CONFIRM,
    // and active_filing_id exactly as-is — only the conversation moves.
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
  const savedDelivered = await sendFilingPlainText(deps.accusedSenderDeps, sendInput, SAVED_TEXT[input.language], "filing_saved_send_failed");
  await finalizeOutbound(deps, commit.outboundIds[0], savedDelivered);

  const menuDelivered = await sendMainMenu(deps.mainMenuSenderDeps, sendInput);
  await finalizeOutbound(deps, commit.outboundIds[1], menuDelivered);

  return { delivered: savedDelivered && menuDelivered };
}

// ---------------------------------------------------------------------------
// Resume support for #8's filing-workflow.ts (Part J).
// ---------------------------------------------------------------------------

/**
 * Resends whatever the advocate should see for a draft resumed into one of
 * #11's steps — the exact pending field prompt, the edit-field picker, or
 * the full summary + review actions at ACCUSED_CONFIRM. Read-only: never
 * mutates the filing/party/conversation itself (the caller in
 * filing-workflow.ts has already restored the conversation's state).
 */
export async function resendAccusedPromptForResume(
  deps: AccusedWorkflowDeps,
  filing: FilingRecord,
  sendInput: SendAccusedMessageInput,
): Promise<boolean> {
  if (filing.currentStep === "ACCUSED_CONFIRM") {
    const party = await fetchParty(deps, filing.id);
    if (!party) {
      // Nothing to resend (party row missing) — safe no-op.
      return true;
    }
    return sendSummaryAndReview(deps, sendInput, party);
  }

  if (filing.currentStep === "ACCUSED_EDIT_FIELD") {
    return sendAccusedEditFields(deps.accusedSenderDeps, sendInput);
  }

  // #33 Part B: entity type resends its own template, not a plain-text field prompt.
  if (filing.currentStep === "ACCUSED_ENTITY_TYPE_PENDING" || filing.currentStep === "ACCUSED_EDIT_ENTITY_TYPE_PENDING") {
    return sendAccusedEntityTypePrompt(deps.accusedSenderDeps, sendInput);
  }

  const field = RESUMABLE_STEP_TO_FIELD[filing.currentStep];
  if (field) {
    return sendFilingPlainText(
      deps.accusedSenderDeps,
      sendInput,
      PROMPT_TEXT[field][sendInput.language],
      `accused_${field}_resume_prompt_send_failed`,
    );
  }

  // Unreachable given filing-workflow.ts only calls this for steps in
  // ACCUSED_SUPPORTED_FILING_STEPS.
  return false;
}
