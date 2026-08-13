import type { TwilioMessagingClient } from "../adapters/twilio/messaging-client";
import type { FilingPartyRecord } from "../repositories/filing-party-repository";
import { formatPhoneForDisplay } from "../lib/format-phone-for-display";
import { logWorkflowError } from "../lib/logger";
import type { SupportedLanguage } from "./main-menu-sender";

/**
 * Sends and copy for the two rich Content Templates in #11 Part E (review-
 * actions quick-reply, edit-fields list-picker) plus the plain-text accused
 * summary that always precedes the review-actions send — mirrors
 * complainant-sender.ts exactly, minus the email line (accused has no email
 * field at all). Field prompts/errors have no Content Template (Part D) and
 * are sent with the generic `sendFilingPlainText` helper directly from
 * accused-workflow.ts, which also owns their copy.
 */
export interface AccusedSenderDeps {
  messagingClient: TwilioMessagingClient;
  fromNumber: string;
  reviewActionsContentSid: Record<SupportedLanguage, string>;
  editFieldsContentSid: Record<SupportedLanguage, string>;
}

export interface SendAccusedMessageInput {
  to: string;
  language: SupportedLanguage;
  /** Twilio MessageSid, used only for safe error correlation — never logged with content. */
  correlationId: string;
}

const SUMMARY_LABELS: Record<SupportedLanguage, { title: string; name: string; phone: string; address: string; notProvided: string }> = {
  en: { title: "Accused party details", name: "Name", phone: "Phone", address: "Address", notProvided: "Not provided" },
  ml: {
    title: "എതിർകക്ഷിയുടെ വിവരങ്ങൾ",
    name: "പേര്",
    phone: "ഫോൺ",
    address: "വിലാസം",
    notProvided: "നൽകിയിട്ടില്ല",
  },
};

/**
 * Renders the localized accused-party summary from persisted party data
 * only (#11 Part F) — never from the current webhook body. No email line
 * (accused has none). Pure formatting; never logged by its callers (Part L).
 */
export function renderAccusedSummary(language: SupportedLanguage, party: FilingPartyRecord): string {
  const labels = SUMMARY_LABELS[language];
  return [
    labels.title,
    "",
    `${labels.name}: ${party.fullName ?? ""}`,
    `${labels.phone}: ${party.phoneNormalized ? formatPhoneForDisplay(party.phoneNormalized) : labels.notProvided}`,
    `${labels.address}:`,
    party.address ?? "",
  ].join("\n");
}

const PLAIN_TEXT_REVIEW_ACTIONS: Record<SupportedLanguage, string> = {
  en: ["Are these accused party details correct?", "", "1. Confirm", "2. Edit", "3. Save and exit", "", "Reply with 1, 2, or 3."].join("\n"),
  ml: [
    "എതിർകക്ഷിയുടെ ഈ വിവരങ്ങൾ ശരിയാണോ?",
    "",
    "1. സ്ഥിരീകരിക്കുക",
    "2. എഡിറ്റ് ചെയ്യുക",
    "3. സേവ് ചെയ്ത് പുറത്തുപോകുക",
    "",
    "1, 2, അല്ലെങ്കിൽ 3 എന്ന് മറുപടി നൽകുക.",
  ].join("\n"),
};

const PLAIN_TEXT_EDIT_FIELDS: Record<SupportedLanguage, string> = {
  en: [
    "Choose the accused party detail you want to edit.",
    "",
    "1. Full/legal name",
    "2. Phone number",
    "3. Address",
    "",
    "Reply with 1, 2, or 3.",
  ].join("\n"),
  ml: [
    "എതിർകക്ഷിയുടെ ഏത് വിവരമാണ് എഡിറ്റ് ചെയ്യേണ്ടത് എന്ന് തിരഞ്ഞെടുക്കുക.",
    "",
    "1. പൂർണ്ണ/നിയമപരമായ പേര്",
    "2. ഫോൺ നമ്പർ",
    "3. വിലാസം",
    "",
    "1, 2, അല്ലെങ്കിൽ 3 എന്ന് മറുപടി നൽകുക.",
  ].join("\n"),
};

/** Sends the persisted accused summary as a plain message (#11 Part F/H) — no Content Template, never the current webhook body. */
export async function sendAccusedSummary(deps: AccusedSenderDeps, input: SendAccusedMessageInput, party: FilingPartyRecord): Promise<boolean> {
  try {
    await deps.messagingClient.sendText({
      from: deps.fromNumber,
      to: input.to,
      body: renderAccusedSummary(input.language, party),
    });
    return true;
  } catch {
    logWorkflowError({ code: "accused_summary_send_failed", correlationId: input.correlationId });
    return false;
  }
}

/** Sends the localized review-action Content Template (twilio/quick-reply), falling back to the numbered plain-text options (#11 Part E/K). */
export async function sendAccusedReviewActions(deps: AccusedSenderDeps, input: SendAccusedMessageInput): Promise<boolean> {
  try {
    await deps.messagingClient.sendContentTemplate({
      from: deps.fromNumber,
      to: input.to,
      contentSid: deps.reviewActionsContentSid[input.language],
    });
    return true;
  } catch {
    logWorkflowError({ code: "accused_review_actions_content_send_failed", correlationId: input.correlationId });

    try {
      await deps.messagingClient.sendText({ from: deps.fromNumber, to: input.to, body: PLAIN_TEXT_REVIEW_ACTIONS[input.language] });
      return true;
    } catch {
      logWorkflowError({ code: "accused_review_actions_fallback_send_failed", correlationId: input.correlationId });
      return false;
    }
  }
}

/** Sends the localized edit-field Content Template (twilio/list-picker), falling back to the numbered plain-text list (#11 Part E/K). */
export async function sendAccusedEditFields(deps: AccusedSenderDeps, input: SendAccusedMessageInput): Promise<boolean> {
  try {
    await deps.messagingClient.sendContentTemplate({
      from: deps.fromNumber,
      to: input.to,
      contentSid: deps.editFieldsContentSid[input.language],
    });
    return true;
  } catch {
    logWorkflowError({ code: "accused_edit_fields_content_send_failed", correlationId: input.correlationId });

    try {
      await deps.messagingClient.sendText({ from: deps.fromNumber, to: input.to, body: PLAIN_TEXT_EDIT_FIELDS[input.language] });
      return true;
    } catch {
      logWorkflowError({ code: "accused_edit_fields_fallback_send_failed", correlationId: input.correlationId });
      return false;
    }
  }
}
