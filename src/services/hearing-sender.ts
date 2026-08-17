import type { TwilioMessagingClient } from "../adapters/twilio/messaging-client";
import type { FilingRecord } from "../repositories/filing-repository";
import { formatIsoDateAsDisplay, formatIstTimestamp } from "../lib/format-ist-date";
import { logWorkflowError } from "../lib/logger";
import type { SupportedLanguage } from "./main-menu-sender";

/**
 * Sends and copy for #38 (Prototype parity — Phase 10): the proactive
 * hearing reminder, the attend acknowledgement, the adjournment intro/date
 * prompts, and the filed-IA acknowledgement.
 *
 * Scope decision (confirmed): the hearing reminder itself is this
 * codebase's first genuinely proactive, out-of-session message — every
 * other Content Template send happens in reply to an inbound message,
 * where WhatsApp's 24-hour customer-service session window is open by
 * construction. `hearingReminderActionsContentSid` MUST be an
 * **approved** WhatsApp Message Template before this ships to any
 * non-Sandbox number (PRD.md §10) — the Sandbox does not enforce template
 * approval, so it is fully testable there the same way every other
 * Content Template in this codebase already is, but that is not evidence
 * of production-readiness. This requirement is flagged, not solved, here
 * (see the issue's own Out of scope).
 *
 * Court-hall/hearing-purpose text is the prototype's own fixed demo
 * narrative (no column stores it — Part B has none), reproduced
 * verbatim/translated, matching #37's identical treatment of its fixed
 * defect descriptions. Every value this app itself generates or persists
 * (diary number, hearing date/time, IA number, ground, requested date) is
 * the filing's own real data, never hardcoded.
 */
export interface HearingSenderDeps {
  messagingClient: TwilioMessagingClient;
  fromNumber: string;
  hearingReminderActionsContentSid: Record<SupportedLanguage, string>;
}

export interface SendHearingMessageInput {
  to: string;
  language: SupportedLanguage;
  /** Twilio MessageSid, used only for safe error correlation — never logged with content. */
  correlationId: string;
}

async function sendPlain(
  deps: { messagingClient: TwilioMessagingClient; fromNumber: string },
  input: SendHearingMessageInput,
  body: string,
  errorCode: string,
): Promise<boolean> {
  try {
    await deps.messagingClient.sendText({ from: deps.fromNumber, to: input.to, body });
    return true;
  } catch {
    logWorkflowError({ code: errorCode, correlationId: input.correlationId });
    return false;
  }
}

// ---------------------------------------------------------------------------
// The proactive reminder — a plain text summary, then the approved-template
// Content Template carrying the will-attend/seek-adjournment actions.
// ---------------------------------------------------------------------------

// Fixed demo narrative (see file header) — the prototype's own updReminder text.
const HEARING_PURPOSE_TEXT: Record<SupportedLanguage, string> = {
  en: "court hall 3, for cross-examination of PW-1",
  ml: "കോർട്ട് ഹാൾ 3-ൽ PW-1-ന്റെ ക്രോസ് വിസ്താരത്തിന്",
};

export function renderHearingReminder(language: SupportedLanguage, filing: FilingRecord): string {
  const when = filing.nextHearingDate ? formatIstTimestamp(filing.nextHearingDate) : "";
  return language === "ml"
    ? [
        "⏰ *നാളെ ഹിയറിംഗ്*",
        "",
        `*${filing.diaryNumber ?? ""}* നാളെ *${when}*, ${HEARING_PURPOSE_TEXT.ml} ലിസ്റ്റ് ചെയ്തിട്ടുണ്ട്.`,
        "",
        "പരാതിക്കാരനു വേണ്ടിയാണ് നിങ്ങൾ ഹാജരാകുന്നത്.",
        "",
        "നിങ്ങൾ ഹാജരാകുമോ?",
      ].join("\n")
    : [
        "⏰ *Hearing tomorrow*",
        "",
        `*${filing.diaryNumber ?? ""}* is listed tomorrow, *${when}*, ${HEARING_PURPOSE_TEXT.en}.`,
        "",
        "You appear for the complainant.",
        "",
        "Will you be attending?",
      ].join("\n");
}

const PLAIN_TEXT_HEARING_REMINDER_ACTIONS: Record<SupportedLanguage, string> = {
  en: ["1. Yes, I'll attend", "2. Seek an adjournment", "", "Reply with 1 or 2."].join("\n"),
  ml: ["1. അതെ, ഹാജരാകും", "2. മാറ്റിവയ്ക്കാൻ അപേക്ഷിക്കുക", "", "1 അല്ലെങ്കിൽ 2 എന്ന് മറുപടി നൽകുക."].join("\n"),
};

export function sendHearingReminder(deps: { messagingClient: TwilioMessagingClient; fromNumber: string }, input: SendHearingMessageInput, filing: FilingRecord): Promise<boolean> {
  return sendPlain(deps, input, renderHearingReminder(input.language, filing), "hearing_reminder_send_failed");
}

/** Sends the will-attend/seek-adjournment Content Template — MUST be an approved WhatsApp Message Template in production (see file header). Falls back to numbered plain text, same as every other Content Template send in this codebase. */
export async function sendHearingReminderActions(deps: HearingSenderDeps, input: SendHearingMessageInput): Promise<boolean> {
  try {
    await deps.messagingClient.sendContentTemplate({ from: deps.fromNumber, to: input.to, contentSid: deps.hearingReminderActionsContentSid[input.language] });
    return true;
  } catch {
    logWorkflowError({ code: "hearing_reminder_actions_content_send_failed", correlationId: input.correlationId });
    try {
      await deps.messagingClient.sendText({ from: deps.fromNumber, to: input.to, body: PLAIN_TEXT_HEARING_REMINDER_ACTIONS[input.language] });
      return true;
    } catch {
      logWorkflowError({ code: "hearing_reminder_actions_fallback_send_failed", correlationId: input.correlationId });
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// hearing:will-attend — a plain acknowledgement, no state change at all.
// ---------------------------------------------------------------------------

const ATTEND_OK_TEXT: Record<SupportedLanguage, string> = {
  en: [
    "👍 Noted — you're marked as appearing.",
    "",
    "I'll remind you at *9:30 AM* tomorrow. Reach by 10:45; the board is called from 11:00 and cheque matters are taken in the first hour.",
    "",
    "If anything changes, tell me here and I'll move it to an adjournment request.",
  ].join("\n"),
  ml: [
    "👍 ശരി — നിങ്ങൾ ഹാജരാകുന്നതായി രേഖപ്പെടുത്തി.",
    "",
    "നാളെ *രാവിലെ 9:30*-ന് ഓർമ്മിപ്പിക്കാം. 10:45-നകം എത്തുക; 11:00 മുതൽ ബോർഡ് വിളിക്കും, ചെക്ക് കേസുകൾ ആദ്യ മണിക്കൂറിലാണ്.",
    "",
    "മാറ്റമുണ്ടെങ്കിൽ ഇവിടെ പറഞ്ഞാൽ മാറ്റിവയ്ക്കൽ അപേക്ഷയാക്കി മാറ്റാം.",
  ].join("\n"),
};

export function sendAttendOk(deps: { messagingClient: TwilioMessagingClient; fromNumber: string }, input: SendHearingMessageInput): Promise<boolean> {
  return sendPlain(deps, input, ATTEND_OK_TEXT[input.language], "hearing_attend_ok_send_failed");
}

// ---------------------------------------------------------------------------
// hearing:seek-adjournment — adjIntro doubles as the ground prompt (its own
// closing line already asks for it), then the date prompt once ground is given.
// ---------------------------------------------------------------------------

const ADJ_INTRO_TEXT: Record<SupportedLanguage, string> = {
  en: "An adjournment is not automatic — under *Section 309 CrPC* the court adjourns only for reasons it records. Cheque cases at the ON Court are on a fast track, so tell me the real ground and I'll put it plainly.",
  ml: "മാറ്റിവയ്ക്കൽ സ്വയമേവ ലഭിക്കില്ല — *CrPC വകുപ്പ് 309* പ്രകാരം കാരണം രേഖപ്പെടുത്തിയാൽ മാത്രമേ കോടതി മാറ്റിവയ്ക്കൂ. ON കോർട്ടിലെ ചെക്ക് കേസുകൾ വേഗത്തിലാണ്, അതിനാൽ യഥാർത്ഥ കാരണം പറയുക.",
};

const ADJ_GROUND_INVALID_TEXT: Record<SupportedLanguage, string> = {
  en: "Please tell me the ground for the adjournment.",
  ml: "ദയവായി മാറ്റിവയ്ക്കുന്നതിനുള്ള കാരണം പറയുക.",
};

const ADJ_DATE_PROMPT_TEXT: Record<SupportedLanguage, string> = {
  en: "What date would you like to request? Reply as DD-MM-YYYY.",
  ml: "ഏത് തീയതിയാണ് ആവശ്യപ്പെടേണ്ടത്? DD-MM-YYYY എന്ന രീതിയിൽ മറുപടി നൽകുക.",
};

const ADJ_DATE_INVALID_TEXT: Record<SupportedLanguage, string> = {
  en: "That doesn't look like a valid date. Please reply as DD-MM-YYYY.",
  ml: "അത് സാധുവായ തീയതിയായി തോന്നുന്നില്ല. ദയവായി DD-MM-YYYY എന്ന രീതിയിൽ മറുപടി നൽകുക.",
};

export function sendAdjIntro(deps: { messagingClient: TwilioMessagingClient; fromNumber: string }, input: SendHearingMessageInput): Promise<boolean> {
  return sendPlain(deps, input, ADJ_INTRO_TEXT[input.language], "hearing_adj_intro_send_failed");
}

export function sendAdjGroundInvalid(deps: { messagingClient: TwilioMessagingClient; fromNumber: string }, input: SendHearingMessageInput): Promise<boolean> {
  return sendPlain(deps, input, ADJ_GROUND_INVALID_TEXT[input.language], "hearing_adj_ground_invalid_send_failed");
}

export function sendAdjDatePrompt(deps: { messagingClient: TwilioMessagingClient; fromNumber: string }, input: SendHearingMessageInput): Promise<boolean> {
  return sendPlain(deps, input, ADJ_DATE_PROMPT_TEXT[input.language], "hearing_adj_date_prompt_send_failed");
}

export function sendAdjDateInvalid(deps: { messagingClient: TwilioMessagingClient; fromNumber: string }, input: SendHearingMessageInput): Promise<boolean> {
  return sendPlain(deps, input, ADJ_DATE_INVALID_TEXT[input.language], "hearing_adj_date_invalid_send_failed");
}

// ---------------------------------------------------------------------------
// adjFiled — the IA acknowledgement, from the filing's own persisted
// adjournmentIaNumber/diaryNumber/adjournmentGround/adjournmentRequestedDate.
// ---------------------------------------------------------------------------

export function renderAdjFiled(language: SupportedLanguage, filing: FilingRecord): string {
  const date = filing.adjournmentRequestedDate ? formatIsoDateAsDisplay(filing.adjournmentRequestedDate) : "";
  return language === "ml"
    ? [
        "✅ *മാറ്റിവയ്ക്കൽ അപേക്ഷ ഫയൽ ചെയ്തു*",
        "",
        `IA *${filing.adjournmentIaNumber ?? ""}*, *${filing.diaryNumber ?? ""}*-ൽ`,
        `കാരണം: ${filing.adjournmentGround ?? ""}`,
        `ആവശ്യപ്പെട്ട തീയതി: *${date}*`,
        "",
        "നാളെ 11:00-ന് കേസ് വിളിക്കുമ്പോൾ ഇത് സമർപ്പിക്കും. *കോടതി നിരസിച്ചേക്കാം* — അനുവദിക്കുന്നതുവരെ നിങ്ങളോ നിങ്ങളുടെ ബ്രീഫ് കൈവശമുള്ള അഭിഭാഷകനോ ഹാജരാകണം.",
        "",
        "ഉത്തരവ് ലഭിക്കുന്ന മുറയ്ക്ക് ഇവിടെ അയക്കാം.",
      ].join("\n")
    : [
        "✅ *Adjournment petition filed*",
        "",
        `IA *${filing.adjournmentIaNumber ?? ""}* in *${filing.diaryNumber ?? ""}*`,
        `Ground: ${filing.adjournmentGround ?? ""}`,
        `Date sought: *${date}*`,
        "",
        "It will be moved when the case is called at 11:00 AM tomorrow. *The court may refuse it* — until it's allowed, you or a counsel holding your brief must be present.",
        "",
        "I'll send the order here as soon as it's passed.",
      ].join("\n");
}

export function sendAdjFiled(deps: { messagingClient: TwilioMessagingClient; fromNumber: string }, input: SendHearingMessageInput, filing: FilingRecord): Promise<boolean> {
  return sendPlain(deps, input, renderAdjFiled(input.language, filing), "hearing_adj_filed_send_failed");
}
