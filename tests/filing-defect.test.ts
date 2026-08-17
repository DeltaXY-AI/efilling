import { describe, expect, it } from "vitest";
import {
  parseDefectAlertAction,
  parseDefectReviewAction,
  parseDefectSentAction,
  parseDelayDaysSelection,
  validateDelayReason,
} from "../src/domain/filing-defect";

/** Covers #37 (Prototype parity — Phase 9): the scrutiny-defect correction flow's action parsers and delay-reason validation. */
describe("parseDefectAlertAction", () => {
  it("resolves a stable-ID button tap", () => {
    expect(parseDefectAlertAction({ buttonPayload: "filing:correct-defects" })).toBe("filing:correct-defects");
  });

  it("an unrecognized stable ID is never a fallback into text matching", () => {
    expect(parseDefectAlertAction({ buttonPayload: "filing:something-else", body: "1" })).toBeNull();
  });

  it("accepts the numbered plain-text fallback", () => {
    expect(parseDefectAlertAction({ body: "1" })).toBe("filing:correct-defects");
  });

  it("accepts the exact localized title, case-insensitively", () => {
    expect(parseDefectAlertAction({ body: "Correct The Defects" })).toBe("filing:correct-defects");
  });

  it("returns null for unrecognized input", () => {
    expect(parseDefectAlertAction({ body: "hello" })).toBeNull();
    expect(parseDefectAlertAction({})).toBeNull();
  });
});

describe("parseDelayDaysSelection", () => {
  it("resolves each stable-ID button tap to its numeric value", () => {
    expect(parseDelayDaysSelection({ buttonPayload: "filing:delay-2" })).toBe(2);
    expect(parseDelayDaysSelection({ buttonPayload: "filing:delay-3" })).toBe(3);
    expect(parseDelayDaysSelection({ buttonPayload: "filing:delay-5" })).toBe(5);
  });

  it("an unrecognized stable ID is never a fallback into text matching", () => {
    expect(parseDelayDaysSelection({ buttonPayload: "filing:delay-9", body: "1" })).toBeNull();
  });

  it("accepts the numbered plain-text fallback (position, not the day count itself)", () => {
    expect(parseDelayDaysSelection({ body: "1" })).toBe(2);
    expect(parseDelayDaysSelection({ body: "2" })).toBe(3);
    expect(parseDelayDaysSelection({ body: "3" })).toBe(5);
  });

  it("accepts the exact localized title, case-insensitively", () => {
    expect(parseDelayDaysSelection({ body: "3 Days" })).toBe(3);
  });

  it("returns null for unrecognized input", () => {
    expect(parseDelayDaysSelection({ body: "4 days" })).toBeNull();
    expect(parseDelayDaysSelection({})).toBeNull();
  });
});

describe("validateDelayReason", () => {
  it("accepts non-empty text, trimmed", () => {
    expect(validateDelayReason("  The advocate was on leave.  ")).toEqual({ valid: true, normalized: "The advocate was on leave." });
  });

  it("rejects empty/whitespace-only input", () => {
    expect(validateDelayReason("   ")).toEqual({ valid: false, reason: "REQUIRED" });
  });

  it("rejects text over 600 characters", () => {
    expect(validateDelayReason("a".repeat(601))).toEqual({ valid: false, reason: "TOO_LONG" });
  });

  it("accepts exactly 600 characters", () => {
    const text = "a".repeat(600);
    expect(validateDelayReason(text)).toEqual({ valid: true, normalized: text });
  });
});

describe("parseDefectReviewAction", () => {
  it("resolves a stable-ID button tap", () => {
    expect(parseDefectReviewAction({ buttonPayload: "filing:defect-confirm" })).toBe("filing:defect-confirm");
  });

  it("accepts the numbered plain-text fallback", () => {
    expect(parseDefectReviewAction({ body: "1" })).toBe("filing:defect-confirm");
  });

  it("returns null for unrecognized input", () => {
    expect(parseDefectReviewAction({ body: "hello" })).toBeNull();
  });
});

describe("parseDefectSentAction", () => {
  it("resolves a stable-ID button tap", () => {
    expect(parseDefectSentAction({ buttonPayload: "nav:main-menu" })).toBe("nav:main-menu");
  });

  it("accepts the numbered plain-text fallback", () => {
    expect(parseDefectSentAction({ body: "1" })).toBe("nav:main-menu");
  });

  it("accepts the exact localized title, case-insensitively", () => {
    expect(parseDefectSentAction({ body: "Main Menu" })).toBe("nav:main-menu");
  });

  it("returns null for unrecognized input", () => {
    expect(parseDefectSentAction({ body: "hello" })).toBeNull();
  });
});
