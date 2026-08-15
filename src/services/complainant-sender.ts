import type { TwilioMessagingClient } from "../adapters/twilio/messaging-client";
import type { FilingPartyRecord } from "../repositories/filing-party-repository";
import { formatPhoneForDisplay } from "../lib/format-phone-for-display";
import { logWorkflowError } from "../lib/logger";
import type { SupportedLanguage } from "./main-menu-sender";

/**
 * Sends and copy for the two rich Content Templates in #10 Part E (review-
 * actions quick-reply, edit-fields list-picker) plus the plain-text
 * complainant summary that always precedes the review-actions send (Part
 * E: "avoids storing PII inside reusable template definitions"). Field
 * prompts/errors have no Content Template at all (Part D) and are sent
 * with the generic `sendFilingPlainText` helper directly from
 * complainant-workflow.ts, which also owns their copy — mirroring how
 * enrolment-sender.ts only owns copy tied to an actual template.
 */
export interface ComplainantSenderDeps {
  messagingClient: TwilioMessagingClient;
  fromNumber: string;
  reviewActionsContentSid: Record<SupportedLanguage, string>;
  editFieldsContentSid: Record<SupportedLanguage, string>;
}

export interface SendComplainantMessageInput {
  to: string;
  language: SupportedLanguage;
  /** Twilio MessageSid, used only for safe error correlation — never logged with content. */
  correlationId: string;
}

const SUMMARY_LABELS: Record<SupportedLanguage, { title: string; name: string; phone: string; email: string; address: string; notProvided: string }> = {
  en: { title: "Complainant details", name: "Name", phone: "Phone", email: "Email", address: "Address", notProvided: "Not provided" },
  ml: {
    title: "പരാതിക്കാരന്റെ വിവരങ്ങൾ",
    name: "പേര്",
    phone: "ഫോൺ",
    email: "ഇമെയിൽ",
    address: "വിലാസം",
    notProvided: "നൽകിയിട്ടില്ല",
  },
};

/**
 * Renders the localized complainant summary from persisted party data only
 * (#10 Part F/H) — never from the current webhook body. Pure formatting;
 * never logged by its callers (Part M).
 */
export function renderComplainantSummary(language: SupportedLanguage, party: FilingPartyRecord): string {
  const labels = SUMMARY_LABELS[language];
  return [
    labels.title,
    "",
    `${labels.name}: ${party.fullName ?? ""}`,
    `${labels.phone}: ${party.phoneNormalized ? formatPhoneForDisplay(party.phoneNormalized) : ""}`,
    `${labels.email}: ${party.emailNormalized ?? labels.notProvided}`,
    `${labels.address}:`,
    party.address ?? "",
  ].join("\n");
}

const PLAIN_TEXT_REVIEW_ACTIONS: Record<SupportedLanguage, string> = {
  en: ["Are these complainant details correct?", "", "1. Confirm", "2. Edit", "3. Save and exit", "", "Reply with 1, 2, or 3."].join("\n"),
  ml: [
    "ഈ പരാതിക്കാരന്റെ വിവരങ്ങൾ ശരിയാണോ?",
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
    "Choose the complainant detail you want to edit.",
    "",
    "1. Full name",
    "2. Phone number",
    "3. Email",
    "4. Address",
    "",
    "Reply with 1, 2, 3, or 4.",
  ].join("\n"),
  ml: [
    "പരാതിക്കാരന്റെ ഏത് വിവരമാണ് എഡിറ്റ് ചെയ്യേണ്ടത് എന്ന് തിരഞ്ഞെടുക്കുക.",
    "",
    "1. പൂർണ്ണ പേര്",
    "2. ഫോൺ നമ്പർ",
    "3. ഇമെയിൽ",
    "4. വിലാസം",
    "",
    "1, 2, 3, അല്ലെങ്കിൽ 4 എന്ന് മറുപടി നൽകുക.",
  ].join("\n"),
};

/** Sends the persisted complainant summary as a plain message (#10 Part F/H) — no Content Template, never the current webhook body. */
export async function sendComplainantSummary(
  deps: ComplainantSenderDeps,
  input: SendComplainantMessageInput,
  party: FilingPartyRecord,
): Promise<boolean> {
  try {
    await deps.messagingClient.sendText({
      from: deps.fromNumber,
      to: input.to,
      body: renderComplainantSummary(input.language, party),
    });
    return true;
  } catch {
    logWorkflowError({ code: "complainant_summary_send_failed", correlationId: input.correlationId });
    return false;
  }
}

/** Sends the localized review-action Content Template (twilio/quick-reply), falling back to the numbered plain-text options (#10 Part E/L). */
export async function sendComplainantReviewActions(deps: ComplainantSenderDeps, input: SendComplainantMessageInput): Promise<boolean> {
  try {
    await deps.messagingClient.sendContentTemplate({
      from: deps.fromNumber,
      to: input.to,
      contentSid: deps.reviewActionsContentSid[input.language],
    });
    return true;
  } catch {
    logWorkflowError({ code: "complainant_review_actions_content_send_failed", correlationId: input.correlationId });

    try {
      await deps.messagingClient.sendText({ from: deps.fromNumber, to: input.to, body: PLAIN_TEXT_REVIEW_ACTIONS[input.language] });
      return true;
    } catch {
      logWorkflowError({ code: "complainant_review_actions_fallback_send_failed", correlationId: input.correlationId });
      return false;
    }
  }
}

/** Sends the localized edit-field Content Template (twilio/list-picker), falling back to the numbered plain-text list (#10 Part E/L). */
export async function sendComplainantEditFields(deps: ComplainantSenderDeps, input: SendComplainantMessageInput): Promise<boolean> {
  try {
    await deps.messagingClient.sendContentTemplate({
      from: deps.fromNumber,
      to: input.to,
      contentSid: deps.editFieldsContentSid[input.language],
    });
    return true;
  } catch {
    logWorkflowError({ code: "complainant_edit_fields_content_send_failed", correlationId: input.correlationId });

    try {
      await deps.messagingClient.sendText({ from: deps.fromNumber, to: input.to, body: PLAIN_TEXT_EDIT_FIELDS[input.language] });
      return true;
    } catch {
      logWorkflowError({ code: "complainant_edit_fields_fallback_send_failed", correlationId: input.correlationId });
      return false;
    }
  }
}
