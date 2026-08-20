import type { TwilioMessagingClient } from "../adapters/twilio/messaging-client";
import type { FilingPartyRecord } from "../repositories/filing-party-repository";
import { formatPhoneForDisplay } from "../lib/format-phone-for-display";
import { logWorkflowError } from "../lib/logger";
import type { SupportedLanguage } from "./main-menu-sender";

/**
 * Sends and copy for the rich Content Templates in #10 Part E (review-
 * actions quick-reply, edit-fields list-picker) plus the plain-text
 * complainant summary that always precedes the review-actions send (Part
 * E: "avoids storing PII inside reusable template definitions"). #33 Part A
 * adds a third template: the "Filing as" quick-reply. Field prompts/errors
 * have no Content Template at all (Part D) and are sent with the generic
 * `sendFilingPlainText` helper directly from complainant-workflow.ts, which
 * also owns their copy — mirroring how enrolment-sender.ts only owns copy
 * tied to an actual template.
 */
export interface ComplainantSenderDeps {
  messagingClient: TwilioMessagingClient;
  fromNumber: string;
  reviewActionsContentSid: Record<SupportedLanguage, string>;
  editFieldsContentSid: Record<SupportedLanguage, string>;
  /** #33 Part A — the "Filing as" quick-reply (Myself (litigant) / Advocate for client). */
  rolePromptContentSid: Record<SupportedLanguage, string>;
  /**
   * The shared "Skip" quick-reply button (filing-sender.ts's
   * sendFilingPromptWithOptionalButton), used only for the optional email
   * field. `undefined` until provisioned — email then falls back to its
   * original plain-text "reply Skip" prompt, unchanged.
   */
  fieldSkipContentSid?: Record<SupportedLanguage, string>;
}

export interface SendComplainantMessageInput {
  to: string;
  language: SupportedLanguage;
  /** Twilio MessageSid, used only for safe error correlation — never logged with content. */
  correlationId: string;
}

const SUMMARY_LABELS: Record<
  SupportedLanguage,
  { title: string; role: string; roleSelf: string; roleAdvocate: string; enrolment: string; name: string; phone: string; email: string; address: string; notProvided: string }
> = {
  en: {
    title: "Complainant details",
    role: "Filing as",
    roleSelf: "Myself (litigant)",
    roleAdvocate: "Advocate for client",
    enrolment: "Enrolment number",
    name: "Name",
    phone: "Phone",
    email: "Email",
    address: "Address",
    notProvided: "Not provided",
  },
  ml: {
    title: "പരാതിക്കാരന്റെ വിവരങ്ങൾ",
    role: "ഫയൽ ചെയ്യുന്നത്",
    roleSelf: "ഞാൻ തന്നെ (കക്ഷി)",
    roleAdvocate: "അഭിഭാഷകൻ, കക്ഷിക്കായി",
    enrolment: "എൻറോൾമെന്റ് നമ്പർ",
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
 * never logged by its callers (Part M). #33 Part A prepends the "Filing as"
 * role and, when representing a client, the representative's enrolment
 * number — the enrolment line is omitted entirely when filing as self.
 */
export function renderComplainantSummary(language: SupportedLanguage, party: FilingPartyRecord): string {
  const labels = SUMMARY_LABELS[language];
  const roleLine = `${labels.role}: ${party.filingAsRole === "ADVOCATE_FOR_CLIENT" ? labels.roleAdvocate : labels.roleSelf}`;
  const lines = [labels.title, "", roleLine];
  if (party.filingAsRole === "ADVOCATE_FOR_CLIENT") {
    lines.push(`${labels.enrolment}: ${party.representativeEnrolmentNumber ?? ""}`);
  }
  lines.push(
    `${labels.name}: ${party.fullName ?? ""}`,
    `${labels.phone}: ${party.phoneNormalized ? formatPhoneForDisplay(party.phoneNormalized) : ""}`,
    `${labels.email}: ${party.emailNormalized ?? labels.notProvided}`,
    `${labels.address}:`,
    party.address ?? "",
  );
  return lines.join("\n");
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

// #33 Part A extends this 4-item list to 6, leading with the two new fields
// (Filing as, Enrolment number) to match collection order.
const PLAIN_TEXT_EDIT_FIELDS: Record<SupportedLanguage, string> = {
  en: [
    "Choose the complainant detail you want to edit.",
    "",
    "1. Filing as",
    "2. Enrolment number",
    "3. Full name",
    "4. Phone number",
    "5. Email",
    "6. Address",
    "",
    "Reply with 1, 2, 3, 4, 5, or 6.",
  ].join("\n"),
  ml: [
    "പരാതിക്കാരന്റെ ഏത് വിവരമാണ് എഡിറ്റ് ചെയ്യേണ്ടത് എന്ന് തിരഞ്ഞെടുക്കുക.",
    "",
    "1. ഫയൽ ചെയ്യുന്നത്",
    "2. എൻറോൾമെന്റ് നമ്പർ",
    "3. പൂർണ്ണ പേര്",
    "4. ഫോൺ നമ്പർ",
    "5. ഇമെയിൽ",
    "6. വിലാസം",
    "",
    "1, 2, 3, 4, 5, അല്ലെങ്കിൽ 6 എന്ന് മറുപടി നൽകുക.",
  ].join("\n"),
};

// #33 Part A — the "Filing as" radio's plain-text fallback.
const PLAIN_TEXT_ROLE_PROMPT: Record<SupportedLanguage, string> = {
  en: ["Filing as?", "", "1. Myself (litigant)", "2. Advocate for client", "", "Reply with 1 or 2."].join("\n"),
  ml: ["ഫയൽ ചെയ്യുന്നത്?", "", "1. ഞാൻ തന്നെ (കക്ഷി)", "2. അഭിഭാഷകൻ, കക്ഷിക്കായി", "", "1 അല്ലെങ്കിൽ 2 എന്ന് മറുപടി നൽകുക."].join("\n"),
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

/** Sends the localized "Filing as" quick-reply Content Template (#33 Part A), falling back to the numbered plain-text options. */
export async function sendComplainantRolePrompt(deps: ComplainantSenderDeps, input: SendComplainantMessageInput): Promise<boolean> {
  try {
    await deps.messagingClient.sendContentTemplate({
      from: deps.fromNumber,
      to: input.to,
      contentSid: deps.rolePromptContentSid[input.language],
    });
    return true;
  } catch {
    logWorkflowError({ code: "complainant_role_prompt_content_send_failed", correlationId: input.correlationId });

    try {
      await deps.messagingClient.sendText({ from: deps.fromNumber, to: input.to, body: PLAIN_TEXT_ROLE_PROMPT[input.language] });
      return true;
    } catch {
      logWorkflowError({ code: "complainant_role_prompt_fallback_send_failed", correlationId: input.correlationId });
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
