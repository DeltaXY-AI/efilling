/**
 * Validation, date-range, and action parsing for #38 (Prototype parity —
 * Phase 10): the hearing-reminder and adjournment-request flow. Pure
 * functions, no I/O, no logging of the values they handle, matching every
 * other domain module in this codebase.
 */

// ---------------------------------------------------------------------------
// The hearing-reminder action — recognized GLOBALLY (like "restart"), never
// gated behind a specific conversation state. Scope decision (confirmed):
// "hearing:will-attend" never touches conversation.state at all; only
// "hearing:seek-adjournment" does (see hearing-workflow.ts).
// ---------------------------------------------------------------------------

export type HearingReminderAction = "hearing:will-attend" | "hearing:seek-adjournment";

const HEARING_REMINDER_ACTIONS: ReadonlySet<string> = new Set(["hearing:will-attend", "hearing:seek-adjournment"]);

const HEARING_REMINDER_TEXT_TO_ACTION: Record<string, HearingReminderAction> = {
  "1": "hearing:will-attend",
  "yes, i'll attend": "hearing:will-attend",
  "i'll attend": "hearing:will-attend",
  "അതെ, ഹാജരാകും": "hearing:will-attend",
  "2": "hearing:seek-adjournment",
  "seek an adjournment": "hearing:seek-adjournment",
  "മാറ്റിവയ്ക്കാൻ അപേക്ഷിക്കുക": "hearing:seek-adjournment",
  // The Content Template's own (shorter, <=25-character) button title —
  // see twilio/templates/hearing-reminder-actions.ml.json.
  "മാറ്റിവയ്ക്കൽ അപേക്ഷ": "hearing:seek-adjournment",
};

/** Same shape as every other domain module's selection input — kept local so this module has no dependency on their files. */
export interface HearingSelectionInput {
  buttonPayload?: string;
  buttonText?: string;
  body?: string;
}

export function parseHearingReminderAction(input: HearingSelectionInput): HearingReminderAction | null {
  const stableId = (input.buttonPayload || "").trim();
  if (stableId) {
    return HEARING_REMINDER_ACTIONS.has(stableId) ? (stableId as HearingReminderAction) : null;
  }
  for (const candidate of [(input.body || "").trim().toLowerCase(), (input.buttonText || "").trim().toLowerCase()]) {
    if (candidate in HEARING_REMINDER_TEXT_TO_ACTION) {
      return HEARING_REMINDER_TEXT_TO_ACTION[candidate];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The adjournment ground (free text) — mirrors filing-defect.ts's
// validateDelayReason exactly (same shape, no bank/format constraints).
// ---------------------------------------------------------------------------

export type AdjournmentGroundValidationReason = "REQUIRED" | "TOO_LONG";

export interface AdjournmentGroundValidationResult {
  valid: boolean;
  reason?: AdjournmentGroundValidationReason;
  normalized?: string;
}

const ADJOURNMENT_GROUND_MAX_LENGTH = 600;

export function validateAdjournmentGround(value: string): AdjournmentGroundValidationResult {
  const normalized = value.trim();
  if (!normalized) {
    return { valid: false, reason: "REQUIRED" };
  }
  if (normalized.length > ADJOURNMENT_GROUND_MAX_LENGTH) {
    return { valid: false, reason: "TOO_LONG" };
  }
  return { valid: true, normalized };
}

// ---------------------------------------------------------------------------
// IST calendar-day boundaries, in UTC — India has a single fixed UTC+5:30
// offset year-round (no DST), so this is exact, not an approximation.
// Shared by the Drizzle repository (querying "hearing tomorrow") and the
// send-hearing-reminders script (computing "tomorrow" itself).
// ---------------------------------------------------------------------------

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** "YYYY-MM-DD" (IST) -> the UTC instants spanning that IST calendar day, [start, end). */
export function istDayRangeUtc(istDate: string): { start: Date; end: Date } {
  const [year, month, day] = istDate.split("-").map(Number);
  return {
    start: new Date(Date.UTC(year, month - 1, day) - IST_OFFSET_MS),
    end: new Date(Date.UTC(year, month - 1, day + 1) - IST_OFFSET_MS),
  };
}

/** "YYYY-MM-DD" for the IST calendar date `daysAhead` days after `now`. */
export function istDateOffset(now: Date, daysAhead: number): string {
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const year = istNow.getUTCFullYear();
  const month = istNow.getUTCMonth();
  const day = istNow.getUTCDate();
  const target = new Date(Date.UTC(year, month, day + daysAhead));
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(target.getUTCDate()).padStart(2, "0")}`;
}
