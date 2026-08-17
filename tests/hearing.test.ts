import { describe, expect, it } from "vitest";
import { istDateOffset, istDayRangeUtc, parseHearingReminderAction, validateAdjournmentGround } from "../src/domain/hearing";

/** Covers #38 (Prototype parity — Phase 10): the hearing-reminder/adjournment action parser, ground validation, and IST date-range helpers. */
describe("parseHearingReminderAction", () => {
  it("resolves each stable-ID button tap", () => {
    expect(parseHearingReminderAction({ buttonPayload: "hearing:will-attend" })).toBe("hearing:will-attend");
    expect(parseHearingReminderAction({ buttonPayload: "hearing:seek-adjournment" })).toBe("hearing:seek-adjournment");
  });

  it("an unrecognized stable ID is never a fallback into text matching", () => {
    expect(parseHearingReminderAction({ buttonPayload: "hearing:something-else", body: "1" })).toBeNull();
  });

  it("empty buttonPayload falls through to text matching rather than being treated as a present stable ID", () => {
    expect(parseHearingReminderAction({ buttonPayload: "", body: "1" })).toBe("hearing:will-attend");
  });

  it("accepts the numbered plain-text fallback", () => {
    expect(parseHearingReminderAction({ body: "1" })).toBe("hearing:will-attend");
    expect(parseHearingReminderAction({ body: "2" })).toBe("hearing:seek-adjournment");
  });

  it("accepts the exact localized title, case-insensitively", () => {
    expect(parseHearingReminderAction({ body: "Yes, I'll Attend" })).toBe("hearing:will-attend");
    expect(parseHearingReminderAction({ body: "seek an adjournment" })).toBe("hearing:seek-adjournment");
  });

  it("also accepts the Content Template's own shorter Malayalam button title", () => {
    expect(parseHearingReminderAction({ body: "മാറ്റിവയ്ക്കൽ അപേക്ഷ" })).toBe("hearing:seek-adjournment");
  });

  it("falls back to buttonText when body doesn't match", () => {
    expect(parseHearingReminderAction({ body: "asdf", buttonText: "Seek an adjournment" })).toBe("hearing:seek-adjournment");
  });

  it("returns null for unrecognized input", () => {
    expect(parseHearingReminderAction({ body: "hello" })).toBeNull();
    expect(parseHearingReminderAction({})).toBeNull();
  });
});

describe("validateAdjournmentGround", () => {
  it("accepts non-empty text, trimmed", () => {
    expect(validateAdjournmentGround("  Counsel engaged elsewhere.  ")).toEqual({ valid: true, normalized: "Counsel engaged elsewhere." });
  });

  it("rejects empty/whitespace-only input", () => {
    expect(validateAdjournmentGround("   ")).toEqual({ valid: false, reason: "REQUIRED" });
  });

  it("rejects text over 600 characters", () => {
    expect(validateAdjournmentGround("a".repeat(601))).toEqual({ valid: false, reason: "TOO_LONG" });
  });

  it("accepts exactly 600 characters", () => {
    const text = "a".repeat(600);
    expect(validateAdjournmentGround(text)).toEqual({ valid: true, normalized: text });
  });
});

describe("istDayRangeUtc", () => {
  it("returns the UTC instants spanning an IST calendar day (UTC+5:30, no DST)", () => {
    const { start, end } = istDayRangeUtc("2026-04-28");
    // 2026-04-28 00:00 IST == 2026-04-27 18:30 UTC.
    expect(start.toISOString()).toBe("2026-04-27T18:30:00.000Z");
    // 2026-04-29 00:00 IST == 2026-04-28 18:30 UTC.
    expect(end.toISOString()).toBe("2026-04-28T18:30:00.000Z");
  });

  it("a timestamp just inside the IST day falls within [start, end)", () => {
    const { start, end } = istDayRangeUtc("2026-04-28");
    const justAfterMidnightIst = new Date("2026-04-27T18:30:00.001Z");
    const justBeforeNextMidnightIst = new Date("2026-04-28T18:29:59.999Z");
    expect(justAfterMidnightIst.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(justBeforeNextMidnightIst.getTime()).toBeLessThan(end.getTime());
  });
});

describe("istDateOffset", () => {
  it("computes tomorrow's IST calendar date from a UTC instant", () => {
    // 2026-04-27 20:00 UTC == 2026-04-28 01:30 IST — "tomorrow" is 2026-04-29.
    expect(istDateOffset(new Date("2026-04-27T20:00:00.000Z"), 1)).toBe("2026-04-29");
  });

  it("correctly rolls over a month/year boundary", () => {
    // 2025-12-31 10:00 UTC == 2025-12-31 15:30 IST (still 31 Dec) — tomorrow is 1 Jan 2026.
    expect(istDateOffset(new Date("2025-12-31T10:00:00.000Z"), 1)).toBe("2026-01-01");
  });

  it("daysAhead: 0 returns today's IST date", () => {
    expect(istDateOffset(new Date("2026-04-27T10:00:00.000Z"), 0)).toBe("2026-04-27");
  });
});
