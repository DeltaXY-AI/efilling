import type { TwilioMessagingClient } from "../adapters/twilio/messaging-client";
import type { FilingPartyRecord } from "../repositories/filing-party-repository";
import type { FilingRecord } from "../repositories/filing-repository";
import { formatPhoneForDisplay } from "../lib/format-phone-for-display";
import { logWorkflowError } from "../lib/logger";
import type { SupportedLanguage } from "./main-menu-sender";

/**
 * Sends and copy for #33 (Prototype parity — Phase 5) Parts C-F's rich
 * Content Templates (return reason, paid, witness, court, review-actions,
 * the 2-level edit picker, declare) plus the Part F combined review summary
 * across every field collected in Parts A-F. Field prompts/errors for the
 * plain text-only fields (cheque number/date, amount, bank/branch, memo/
 * notice/service dates, story) have no Content Template and are sent with
 * the generic `sendFilingPlainText` helper directly from
 * filing-details-workflow.ts, which also owns their copy — mirroring every
 * other sender file in this codebase.
 */
export interface FilingDetailsSenderDeps {
  messagingClient: TwilioMessagingClient;
  fromNumber: string;
  returnReasonContentSid: Record<SupportedLanguage, string>;
  partPaymentContentSid: Record<SupportedLanguage, string>;
  witnessContentSid: Record<SupportedLanguage, string>;
  courtContentSid: Record<SupportedLanguage, string>;
  reviewActionsContentSid: Record<SupportedLanguage, string>;
  editGroupContentSid: Record<SupportedLanguage, string>;
  editChequeFieldContentSid: Record<SupportedLanguage, string>;
  editNarrativeFieldContentSid: Record<SupportedLanguage, string>;
  declareContentSid: Record<SupportedLanguage, string>;
  /**
   * The shared "Skip" quick-reply button (filing-sender.ts's
   * sendFilingPromptWithOptionalButton), used only for the optional
   * bank/branch and story fields. `undefined` until provisioned — both
   * fields then fall back to their original plain-text "reply Skip"
   * prompts, unchanged.
   */
  fieldSkipContentSid?: Record<SupportedLanguage, string>;
}

export interface SendFilingDetailsMessageInput {
  to: string;
  language: SupportedLanguage;
  /** Twilio MessageSid, used only for safe error correlation — never logged with content. */
  correlationId: string;
}

async function sendWithFallback(
  deps: FilingDetailsSenderDeps,
  input: SendFilingDetailsMessageInput,
  contentSid: string,
  fallbackText: string,
  codePrefix: string,
): Promise<boolean> {
  try {
    await deps.messagingClient.sendContentTemplate({ from: deps.fromNumber, to: input.to, contentSid });
    return true;
  } catch {
    logWorkflowError({ code: `${codePrefix}_content_send_failed`, correlationId: input.correlationId });

    try {
      await deps.messagingClient.sendText({ from: deps.fromNumber, to: input.to, body: fallbackText });
      return true;
    } catch {
      logWorkflowError({ code: `${codePrefix}_fallback_send_failed`, correlationId: input.correlationId });
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Part C: return reason (optional 4-option select) and paid-after-notice
// (required 2-option radio).
// ---------------------------------------------------------------------------

const PLAIN_TEXT_RETURN_REASON: Record<SupportedLanguage, string> = {
  en: [
    "Return reason (optional).",
    "",
    "1. Funds insufficient",
    "2. Payment stopped",
    "3. Account closed",
    "4. Signature differs",
    "",
    "Reply with 1, 2, 3, or 4 — or reply Skip.",
  ].join("\n"),
  ml: [
    "മടക്ക കാരണം (നിർബന്ധമല്ല).",
    "",
    "1. പര്യാപ്തമായ തുകയില്ല",
    "2. പേയ്‌മെന്റ് നിർത്തി",
    "3. അക്കൗണ്ട് അടച്ചു",
    "4. ഒപ്പ് വ്യത്യാസം",
    "",
    "1, 2, 3, അല്ലെങ്കിൽ 4 എന്ന് മറുപടി നൽകുക — അല്ലെങ്കിൽ ഒഴിവാക്കുക.",
  ].join("\n"),
};

export function sendReturnReasonPrompt(deps: FilingDetailsSenderDeps, input: SendFilingDetailsMessageInput): Promise<boolean> {
  return sendWithFallback(deps, input, deps.returnReasonContentSid[input.language], PLAIN_TEXT_RETURN_REASON[input.language], "filing_return_reason_prompt");
}

const PLAIN_TEXT_PART_PAYMENT: Record<SupportedLanguage, string> = {
  en: ["Paid after notice?", "", "1. No, nothing paid", "2. Part payment received", "", "Reply with 1 or 2."].join("\n"),
  ml: ["നോട്ടീസിന് ശേഷം അടച്ചോ?", "", "1. ഒന്നും അടച്ചിട്ടില്ല", "2. ഭാഗിക പേയ്‌മെന്റ് ലഭിച്ചു", "", "1 അല്ലെങ്കിൽ 2 എന്ന് മറുപടി നൽകുക."].join("\n"),
};

export function sendPartPaymentPrompt(deps: FilingDetailsSenderDeps, input: SendFilingDetailsMessageInput): Promise<boolean> {
  return sendWithFallback(deps, input, deps.partPaymentContentSid[input.language], PLAIN_TEXT_PART_PAYMENT[input.language], "filing_part_payment_prompt");
}

// ---------------------------------------------------------------------------
// Part D: witness (required 2-option radio).
// ---------------------------------------------------------------------------

const PLAIN_TEXT_WITNESS: Record<SupportedLanguage, string> = {
  en: ["Was anyone else present?", "", "1. No one else", "2. Someone was present", "", "Reply with 1 or 2."].join("\n"),
  ml: ["മറ്റാരെങ്കിലും ഉണ്ടായിരുന്നോ?", "", "1. മറ്റാരും ഇല്ല", "2. ആരെങ്കിലും ഉണ്ടായിരുന്നു", "", "1 അല്ലെങ്കിൽ 2 എന്ന് മറുപടി നൽകുക."].join("\n"),
};

export function sendWitnessPrompt(deps: FilingDetailsSenderDeps, input: SendFilingDetailsMessageInput): Promise<boolean> {
  return sendWithFallback(deps, input, deps.witnessContentSid[input.language], PLAIN_TEXT_WITNESS[input.language], "filing_witness_prompt");
}

// ---------------------------------------------------------------------------
// Part F: court (hardcoded 3-option select).
// ---------------------------------------------------------------------------

const PLAIN_TEXT_COURT: Record<SupportedLanguage, string> = {
  en: ["Which court?", "", "1. ON Court - I, Kollam", "2. ON Court - II, Kollam", "3. JFCM, Kottarakkara", "", "Reply with 1, 2, or 3."].join("\n"),
  ml: ["ഏത് കോടതി?", "", "1. ON കോടതി - I, കൊല്ലം", "2. ON കോടതി - II, കൊല്ലം", "3. JFCM, കൊട്ടാരക്കര", "", "1, 2, അല്ലെങ്കിൽ 3 എന്ന് മറുപടി നൽകുക."].join("\n"),
};

export function sendCourtPrompt(deps: FilingDetailsSenderDeps, input: SendFilingDetailsMessageInput): Promise<boolean> {
  return sendWithFallback(deps, input, deps.courtContentSid[input.language], PLAIN_TEXT_COURT[input.language], "filing_court_prompt");
}

// ---------------------------------------------------------------------------
// Part F: the combined review across every field collected in Parts A-F,
// review-actions (Confirm/Edit/Save and exit), the 2-level edit picker
// (group, then field within it), and the declaration.
// ---------------------------------------------------------------------------

const RETURN_REASON_LABEL: Record<SupportedLanguage, Record<string, string>> = {
  en: { funds: "Funds insufficient", stop: "Payment stopped", acct: "Account closed", sign: "Signature differs" },
  ml: { funds: "പര്യാപ്തമായ തുകയില്ല", stop: "പേയ്‌മെന്റ് നിർത്തി", acct: "അക്കൗണ്ട് അടച്ചു", sign: "ഒപ്പ് വ്യത്യാസം" },
};

/** Localizes a stored `filing_return_reason` enum value for display in the review summary. */
export function formatReturnReasonLabel(language: SupportedLanguage, reason: string): string {
  return RETURN_REASON_LABEL[language][reason] ?? reason;
}

const REVIEW_LABELS: Record<
  SupportedLanguage,
  {
    title: string;
    complainant: string;
    role: string;
    roleSelf: string;
    roleAdvocate: string;
    enrolment: string;
    name: string;
    phone: string;
    email: string;
    address: string;
    accused: string;
    entityType: string;
    entityIndividual: string;
    entityProprietor: string;
    entityCompany: string;
    chequeAndNotice: string;
    chequeNumber: string;
    chequeDate: string;
    amount: string;
    bankBranch: string;
    returnReason: string;
    memoDate: string;
    noticeDate: string;
    serviceDate: string;
    partPayment: string;
    partPaymentNo: string;
    partPaymentYes: string;
    narrative: string;
    story: string;
    witness: string;
    witnessNo: string;
    witnessYes: string;
    writtenAccountProvided: string;
    court: string;
    notProvided: string;
  }
> = {
  en: {
    title: "Review your filing",
    complainant: "Complainant",
    role: "Filing as",
    roleSelf: "Myself (litigant)",
    roleAdvocate: "Advocate for client",
    enrolment: "Enrolment number",
    name: "Name",
    phone: "Phone",
    email: "Email",
    address: "Address",
    accused: "Accused",
    entityType: "Entity type",
    entityIndividual: "Individual",
    entityProprietor: "Proprietor of a firm",
    entityCompany: "Company/partnership",
    chequeAndNotice: "Cheque and notice",
    chequeNumber: "Cheque number",
    chequeDate: "Cheque date",
    amount: "Amount",
    bankBranch: "Bank and branch",
    returnReason: "Return reason",
    memoDate: "Memo date",
    noticeDate: "Notice date",
    serviceDate: "Notice served on",
    partPayment: "Paid after notice?",
    partPaymentNo: "No, nothing paid",
    partPaymentYes: "Part payment received",
    narrative: "In your own words",
    story: "What happened",
    witness: "Witness",
    witnessNo: "No one else",
    witnessYes: "Someone was present",
    writtenAccountProvided: "Written account provided",
    court: "Court",
    notProvided: "Not provided",
  },
  ml: {
    title: "നിങ്ങളുടെ ഫയലിംഗ് അവലോകനം ചെയ്യുക",
    complainant: "പരാതിക്കാരൻ",
    role: "ഫയൽ ചെയ്യുന്നത്",
    roleSelf: "ഞാൻ തന്നെ (കക്ഷി)",
    roleAdvocate: "അഭിഭാഷകൻ, കക്ഷിക്കായി",
    enrolment: "എൻറോൾമെന്റ് നമ്പർ",
    name: "പേര്",
    phone: "ഫോൺ",
    email: "ഇമെയിൽ",
    address: "വിലാസം",
    accused: "എതിർകക്ഷി",
    entityType: "സ്ഥാപന തരം",
    entityIndividual: "വ്യക്തി",
    entityProprietor: "സ്ഥാപനത്തിന്റെ ഉടമ",
    entityCompany: "കമ്പനി/പങ്കാളിത്തം",
    chequeAndNotice: "ചെക്കും നോട്ടീസും",
    chequeNumber: "ചെക്ക് നമ്പർ",
    chequeDate: "ചെക്ക് തീയതി",
    amount: "തുക",
    bankBranch: "ബാങ്കും ബ്രാഞ്ചും",
    returnReason: "മടക്ക കാരണം",
    memoDate: "മെമ്മോ തീയതി",
    noticeDate: "നോട്ടീസ് തീയതി",
    serviceDate: "നോട്ടീസ് നൽകിയ തീയതി",
    partPayment: "നോട്ടീസിന് ശേഷം അടച്ചോ?",
    partPaymentNo: "ഒന്നും അടച്ചിട്ടില്ല",
    partPaymentYes: "ഭാഗിക പേയ്‌മെന്റ് ലഭിച്ചു",
    narrative: "നിങ്ങളുടെ വാക്കുകളിൽ",
    story: "എന്താണ് സംഭവിച്ചത്",
    witness: "സാക്ഷി",
    witnessNo: "മറ്റാരും ഇല്ല",
    witnessYes: "ആരെങ്കിലും ഉണ്ടായിരുന്നു",
    writtenAccountProvided: "രേഖാമൂലമുള്ള വിവരണം നൽകി",
    court: "കോടതി",
    notProvided: "നൽകിയിട്ടില്ല",
  },
};

/**
 * Renders the full Parts A-F review (Part F: "full summary of every field
 * collected across Parts A-F") from persisted data only — never from the
 * current webhook body. `hasWrittenAccount` reflects whether Part E's
 * optional upload has any files (rendered as a yes/no line, never the file
 * contents themselves).
 */
export function renderFilingReviewSummary(
  language: SupportedLanguage,
  filing: FilingRecord,
  complainant: FilingPartyRecord,
  accused: FilingPartyRecord,
  hasWrittenAccount: boolean,
): string {
  const l = REVIEW_LABELS[language];
  const lines: string[] = [l.title, "", l.complainant, `${l.role}: ${complainant.filingAsRole === "ADVOCATE_FOR_CLIENT" ? l.roleAdvocate : l.roleSelf}`];
  if (complainant.filingAsRole === "ADVOCATE_FOR_CLIENT") {
    lines.push(`${l.enrolment}: ${complainant.representativeEnrolmentNumber ?? ""}`);
  }
  lines.push(
    `${l.name}: ${complainant.fullName ?? ""}`,
    `${l.phone}: ${complainant.phoneNormalized ? formatPhoneForDisplay(complainant.phoneNormalized) : ""}`,
    `${l.email}: ${complainant.emailNormalized ?? l.notProvided}`,
    `${l.address}: ${complainant.address ?? ""}`,
    "",
    l.accused,
    `${l.name}: ${accused.fullName ?? ""}`,
    `${l.phone}: ${accused.phoneNormalized ? formatPhoneForDisplay(accused.phoneNormalized) : l.notProvided}`,
    `${l.address}: ${accused.address ?? ""}`,
    `${l.entityType}: ${accused.entityType ? { INDIVIDUAL: l.entityIndividual, PROPRIETOR: l.entityProprietor, COMPANY: l.entityCompany }[accused.entityType] : ""}`,
    "",
    l.chequeAndNotice,
    `${l.chequeNumber}: ${filing.chequeNumber ?? ""}`,
    `${l.chequeDate}: ${filing.chequeDate ?? ""}`,
    `${l.amount}: ${filing.chequeAmount ?? ""}`,
    `${l.bankBranch}: ${filing.bankBranch ?? l.notProvided}`,
    `${l.returnReason}: ${filing.returnReason ? formatReturnReasonLabel(language, filing.returnReason) : l.notProvided}`,
    `${l.memoDate}: ${filing.memoDate ?? ""}`,
    `${l.noticeDate}: ${filing.noticeDate ?? ""}`,
    `${l.serviceDate}: ${filing.serviceDate ?? ""}`,
    `${l.partPayment}: ${filing.partPayment ? l.partPaymentYes : l.partPaymentNo}`,
    "",
    l.narrative,
    `${l.story}: ${filing.narrative ?? l.notProvided}`,
    `${l.witness}: ${filing.witnessPresent ? l.witnessYes : l.witnessNo}`,
    `${l.writtenAccountProvided}: ${hasWrittenAccount ? l.witnessYes : l.witnessNo}`,
    "",
    `${l.court}: ${filing.selectedCourt ?? ""}`,
  );
  return lines.join("\n");
}

/** Sends the persisted Parts A-F review summary as a plain message — no Content Template, never the current webhook body. */
export async function sendFilingReviewSummary(
  deps: { messagingClient: TwilioMessagingClient; fromNumber: string },
  input: SendFilingDetailsMessageInput,
  filing: FilingRecord,
  complainant: FilingPartyRecord,
  accused: FilingPartyRecord,
  hasWrittenAccount: boolean,
): Promise<boolean> {
  try {
    await deps.messagingClient.sendText({
      from: deps.fromNumber,
      to: input.to,
      body: renderFilingReviewSummary(input.language, filing, complainant, accused, hasWrittenAccount),
    });
    return true;
  } catch {
    logWorkflowError({ code: "filing_review_summary_send_failed", correlationId: input.correlationId });
    return false;
  }
}

const PLAIN_TEXT_REVIEW_ACTIONS: Record<SupportedLanguage, string> = {
  en: ["Is everything above correct?", "", "1. Confirm", "2. Edit", "3. Save and exit", "", "Reply with 1, 2, or 3."].join("\n"),
  ml: [
    "മുകളിലുള്ളതെല്ലാം ശരിയാണോ?",
    "",
    "1. സ്ഥിരീകരിക്കുക",
    "2. എഡിറ്റ് ചെയ്യുക",
    "3. സേവ് ചെയ്ത് പുറത്തുപോകുക",
    "",
    "1, 2, അല്ലെങ്കിൽ 3 എന്ന് മറുപടി നൽകുക.",
  ].join("\n"),
};

export function sendFilingReviewActions(deps: FilingDetailsSenderDeps, input: SendFilingDetailsMessageInput): Promise<boolean> {
  return sendWithFallback(deps, input, deps.reviewActionsContentSid[input.language], PLAIN_TEXT_REVIEW_ACTIONS[input.language], "filing_review_actions");
}

// #33 Part F: only Parts C/D/F's own fields are editable from this review
// (Parts A/B already have their own dedicated #10/#11 review/edit loop) —
// WhatsApp's list-picker caps at 10 rows and Part C alone is 9 fields, so
// editing is a 2-level pick: group, then field within it.
const PLAIN_TEXT_EDIT_GROUP: Record<SupportedLanguage, string> = {
  en: ["Which part do you want to edit?", "", "1. Cheque & notice", "2. Story, witness & court", "", "Reply with 1 or 2."].join("\n"),
  ml: ["ഏത് ഭാഗമാണ് എഡിറ്റ് ചെയ്യേണ്ടത്?", "", "1. ചെക്കും നോട്ടീസും", "2. കഥ, സാക്ഷി, കോടതി", "", "1 അല്ലെങ്കിൽ 2 എന്ന് മറുപടി നൽകുക."].join("\n"),
};

export function sendFilingEditGroupPrompt(deps: FilingDetailsSenderDeps, input: SendFilingDetailsMessageInput): Promise<boolean> {
  return sendWithFallback(deps, input, deps.editGroupContentSid[input.language], PLAIN_TEXT_EDIT_GROUP[input.language], "filing_edit_group_prompt");
}

const PLAIN_TEXT_EDIT_CHEQUE_FIELD: Record<SupportedLanguage, string> = {
  en: [
    "Choose the cheque/notice detail you want to edit.",
    "",
    "1. Cheque number",
    "2. Cheque date",
    "3. Amount",
    "4. Bank and branch",
    "5. Return reason",
    "6. Memo date",
    "7. Notice date",
    "8. Notice served on",
    "9. Paid after notice?",
    "",
    "Reply with a number from 1 to 9.",
  ].join("\n"),
  ml: [
    "ചെക്ക്/നോട്ടീസ് വിവരങ്ങളിൽ ഏതാണ് എഡിറ്റ് ചെയ്യേണ്ടത് എന്ന് തിരഞ്ഞെടുക്കുക.",
    "",
    "1. ചെക്ക് നമ്പർ",
    "2. ചെക്ക് തീയതി",
    "3. തുക",
    "4. ബാങ്കും ബ്രാഞ്ചും",
    "5. മടക്ക കാരണം",
    "6. മെമ്മോ തീയതി",
    "7. നോട്ടീസ് തീയതി",
    "8. നോട്ടീസ് നൽകിയ തീയതി",
    "9. നോട്ടീസിന് ശേഷം അടച്ചോ?",
    "",
    "1 മുതൽ 9 വരെയുള്ള ഒരു നമ്പർ ഉപയോഗിച്ച് മറുപടി നൽകുക.",
  ].join("\n"),
};

export function sendFilingEditChequeFieldPrompt(deps: FilingDetailsSenderDeps, input: SendFilingDetailsMessageInput): Promise<boolean> {
  return sendWithFallback(deps, input, deps.editChequeFieldContentSid[input.language], PLAIN_TEXT_EDIT_CHEQUE_FIELD[input.language], "filing_edit_cheque_field_prompt");
}

const PLAIN_TEXT_EDIT_NARRATIVE_FIELD: Record<SupportedLanguage, string> = {
  en: ["Choose the detail you want to edit.", "", "1. What happened", "2. Witness", "3. Court", "", "Reply with 1, 2, or 3."].join("\n"),
  ml: ["ഏത് വിവരമാണ് എഡിറ്റ് ചെയ്യേണ്ടത് എന്ന് തിരഞ്ഞെടുക്കുക.", "", "1. എന്താണ് സംഭവിച്ചത്", "2. സാക്ഷി", "3. കോടതി", "", "1, 2, അല്ലെങ്കിൽ 3 എന്ന് മറുപടി നൽകുക."].join(
    "\n",
  ),
};

export function sendFilingEditNarrativeFieldPrompt(deps: FilingDetailsSenderDeps, input: SendFilingDetailsMessageInput): Promise<boolean> {
  return sendWithFallback(
    deps,
    input,
    deps.editNarrativeFieldContentSid[input.language],
    PLAIN_TEXT_EDIT_NARRATIVE_FIELD[input.language],
    "filing_edit_narrative_field_prompt",
  );
}

const PLAIN_TEXT_DECLARE: Record<SupportedLanguage, string> = {
  en: [
    "I declare that the facts stated above are true to the best of my knowledge and belief.",
    "",
    "1. I declare",
    "2. Save and exit",
    "",
    "Reply with 1 or 2.",
  ].join("\n"),
  ml: [
    "മുകളിൽ പറഞ്ഞിരിക്കുന്ന വസ്തുതകൾ എന്റെ അറിവിലും വിശ്വാസത്തിലും സത്യമാണെന്ന് ഞാൻ പ്രഖ്യാപിക്കുന്നു.",
    "",
    "1. ഞാൻ പ്രഖ്യാപിക്കുന്നു",
    "2. സേവ് ചെയ്ത് പുറത്തുപോകുക",
    "",
    "1 അല്ലെങ്കിൽ 2 എന്ന് മറുപടി നൽകുക.",
  ].join("\n"),
};

export function sendFilingDeclarePrompt(deps: FilingDetailsSenderDeps, input: SendFilingDetailsMessageInput): Promise<boolean> {
  return sendWithFallback(deps, input, deps.declareContentSid[input.language], PLAIN_TEXT_DECLARE[input.language], "filing_declare_prompt");
}
