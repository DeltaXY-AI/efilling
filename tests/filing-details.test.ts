import { describe, expect, it } from "vitest";
import {
  parseCourtSelection,
  parseFilingChequeEditFieldSelection,
  parseFilingDeclareAction,
  parseFilingEditGroupSelection,
  parseFilingNarrativeEditFieldSelection,
  parseFilingReviewAction,
  parsePartPaymentSelection,
  parseReturnReasonSelection,
  parseWitnessSelection,
  validateBankBranch,
  validateChequeNumber,
  validateFilingAmount,
  validateFilingDate,
  validateNarrative,
  isSkipSelection,
  COURT_OPTIONS,
} from "../src/domain/filing-details";

describe("validateChequeNumber", () => {
  it("requires a non-empty value", () => {
    expect(validateChequeNumber("")).toMatchObject({ valid: false, reason: "REQUIRED" });
    expect(validateChequeNumber("   ")).toMatchObject({ valid: false, reason: "REQUIRED" });
  });

  it("accepts a typical cheque number", () => {
    expect(validateChequeNumber("004512")).toMatchObject({ valid: true, normalized: "004512" });
  });

  it("rejects a value over 40 characters", () => {
    expect(validateChequeNumber("1".repeat(41))).toMatchObject({ valid: false, reason: "INVALID_LENGTH" });
  });

  it("trims and collapses whitespace", () => {
    expect(validateChequeNumber("  004512  ")).toMatchObject({ valid: true, normalized: "004512" });
  });
});

describe("validateFilingDate", () => {
  it("requires a value", () => {
    expect(validateFilingDate("")).toMatchObject({ valid: false, reason: "REQUIRED" });
  });

  it("accepts DD-MM-YYYY and normalizes to ISO", () => {
    expect(validateFilingDate("12-03-2026")).toMatchObject({ valid: true, normalized: "2026-03-12" });
  });

  it("accepts DD/MM/YYYY", () => {
    expect(validateFilingDate("12/03/2026")).toMatchObject({ valid: true, normalized: "2026-03-12" });
  });

  it("rejects an unrecognized format", () => {
    expect(validateFilingDate("March 12, 2026")).toMatchObject({ valid: false, reason: "INVALID_FORMAT" });
    expect(validateFilingDate("2026-03-12")).toMatchObject({ valid: false, reason: "INVALID_FORMAT" });
  });

  it("rejects a calendar-invalid date rather than silently rolling it over", () => {
    expect(validateFilingDate("30-02-2026")).toMatchObject({ valid: false, reason: "INVALID_CALENDAR_DATE" });
    expect(validateFilingDate("31-04-2026")).toMatchObject({ valid: false, reason: "INVALID_CALENDAR_DATE" });
  });

  it("accepts a leap-day date in a leap year", () => {
    expect(validateFilingDate("29-02-2024")).toMatchObject({ valid: true, normalized: "2024-02-29" });
  });

  it("rejects a leap-day date in a non-leap year", () => {
    expect(validateFilingDate("29-02-2026")).toMatchObject({ valid: false, reason: "INVALID_CALENDAR_DATE" });
  });
});

describe("validateFilingAmount", () => {
  it("requires a value", () => {
    expect(validateFilingAmount("")).toMatchObject({ valid: false, reason: "REQUIRED" });
  });

  it("accepts a plain integer", () => {
    expect(validateFilingAmount("450000")).toMatchObject({ valid: true, normalized: "450000" });
  });

  it("accepts Indian-style comma grouping and strips it", () => {
    expect(validateFilingAmount("4,50,000")).toMatchObject({ valid: true, normalized: "450000" });
  });

  it("accepts an optional rupee symbol", () => {
    expect(validateFilingAmount("₹4,50,000")).toMatchObject({ valid: true, normalized: "450000" });
  });

  it("accepts a decimal amount", () => {
    expect(validateFilingAmount("450000.50")).toMatchObject({ valid: true, normalized: "450000.50" });
  });

  it("rejects a zero or negative amount", () => {
    expect(validateFilingAmount("0")).toMatchObject({ valid: false, reason: "INVALID" });
    expect(validateFilingAmount("-500")).toMatchObject({ valid: false, reason: "INVALID" });
  });

  it("rejects non-numeric input", () => {
    expect(validateFilingAmount("four lakh")).toMatchObject({ valid: false, reason: "INVALID" });
  });
});

describe("validateBankBranch (optional)", () => {
  it("treats empty/Skip as valid with normalized null", () => {
    expect(validateBankBranch("")).toMatchObject({ valid: true, normalized: null });
    expect(validateBankBranch("skip")).toMatchObject({ valid: true, normalized: null });
    expect(validateBankBranch("ഒഴിവാക്കുക")).toMatchObject({ valid: true, normalized: null });
  });

  it("accepts a normal value", () => {
    expect(validateBankBranch("South Indian Bank, Chinnakada")).toMatchObject({ valid: true, normalized: "South Indian Bank, Chinnakada" });
  });

  it("rejects a value over 200 characters", () => {
    expect(validateBankBranch("a".repeat(201))).toMatchObject({ valid: false, reason: "INVALID_LENGTH" });
  });
});

describe("validateNarrative (optional)", () => {
  it("treats empty/Skip as valid with normalized null", () => {
    expect(validateNarrative("")).toMatchObject({ valid: true, normalized: null });
    expect(validateNarrative("skip")).toMatchObject({ valid: true, normalized: null });
  });

  it("accepts a typed story, normalizing line endings", () => {
    expect(validateNarrative("Lent Rs 50,000\r\nfor a business.")).toMatchObject({ valid: true, normalized: "Lent Rs 50,000\nfor a business." });
  });

  it("rejects a value over 4000 characters", () => {
    expect(validateNarrative("a".repeat(4001))).toMatchObject({ valid: false, reason: "INVALID_LENGTH" });
  });
});

describe("parseReturnReasonSelection (optional 4-option select)", () => {
  it.each([
    ["1", "funds"],
    ["Funds insufficient", "funds"],
    ["2", "stop"],
    ["Payment stopped", "stop"],
    ["3", "acct"],
    ["Account closed", "acct"],
    ["4", "sign"],
    ["Signature differs", "sign"],
  ])("recognizes %s as %s", (value, expected) => {
    expect(parseReturnReasonSelection({ body: value })).toBe(expected);
  });

  it("returns null for unrecognized input", () => {
    expect(parseReturnReasonSelection({ body: "asdf" })).toBeNull();
  });

  it("isSkipSelection recognizes empty/Skip as a valid skip, distinct from an unrecognized answer", () => {
    expect(isSkipSelection({ body: "" })).toBe(true);
    expect(isSkipSelection({ body: "skip" })).toBe(true);
    expect(isSkipSelection({ body: "asdf" })).toBe(false);
  });
});

describe("parsePartPaymentSelection (required 2-option radio)", () => {
  it.each([
    ["1", false],
    ["No, nothing paid", false],
    ["2", true],
    ["Part payment received", true],
  ])("recognizes %s as %s", (value, expected) => {
    expect(parsePartPaymentSelection({ body: value })).toBe(expected);
  });

  it("returns null for unrecognized input", () => {
    expect(parsePartPaymentSelection({ body: "asdf" })).toBeNull();
  });
});

describe("parseWitnessSelection (required 2-option radio)", () => {
  it.each([
    ["1", false],
    ["No one else", false],
    ["2", true],
    ["Someone was present", true],
  ])("recognizes %s as %s", (value, expected) => {
    expect(parseWitnessSelection({ body: value })).toBe(expected);
  });

  it("returns null for unrecognized input", () => {
    expect(parseWitnessSelection({ body: "asdf" })).toBeNull();
  });
});

describe("parseCourtSelection (hardcoded 3-option select)", () => {
  it.each([
    ["1", COURT_OPTIONS[0]],
    ["ON Court - I, Kollam", COURT_OPTIONS[0]],
    ["2", COURT_OPTIONS[1]],
    ["3", COURT_OPTIONS[2]],
    ["JFCM, Kottarakkara", COURT_OPTIONS[2]],
  ])("recognizes %s as %s", (value, expected) => {
    expect(parseCourtSelection({ body: value })).toBe(expected);
  });

  it("returns null for unrecognized input", () => {
    expect(parseCourtSelection({ body: "Some other court" })).toBeNull();
  });
});

describe("parseFilingReviewAction", () => {
  it.each([
    ["1", "filing:confirm"],
    ["confirm", "filing:confirm"],
    ["2", "filing:edit"],
    ["edit", "filing:edit"],
    ["3", "filing:save-exit"],
    ["save and exit", "filing:save-exit"],
  ])("recognizes %s as %s", (value, expected) => {
    expect(parseFilingReviewAction({ body: value })).toBe(expected);
  });

  it("a supplied stable ID is authoritative, never falling back to text", () => {
    expect(parseFilingReviewAction({ buttonPayload: "filing:confirm", body: "something else" })).toBe("filing:confirm");
    expect(parseFilingReviewAction({ buttonPayload: "not-a-real-action" })).toBeNull();
  });
});

describe("parseFilingEditGroupSelection (2-level edit picker, level 1)", () => {
  it.each([
    ["1", "cheque"],
    ["Cheque & notice", "cheque"],
    ["2", "narrative"],
    ["Story, witness & court", "narrative"],
  ])("recognizes %s as %s", (value, expected) => {
    expect(parseFilingEditGroupSelection({ body: value })).toBe(expected);
  });

  it("returns null for unrecognized input", () => {
    expect(parseFilingEditGroupSelection({ body: "asdf" })).toBeNull();
  });
});

describe("parseFilingChequeEditFieldSelection (2-level edit picker, level 2 — cheque group)", () => {
  it("resolves every one of the 9 cheque/notice fields by stable ButtonPayload", () => {
    const cases: Array<[string, string]> = [
      ["filing:edit-cheque-number", "chequeNumber"],
      ["filing:edit-cheque-date", "chequeDate"],
      ["filing:edit-amount", "amount"],
      ["filing:edit-bank-branch", "bankBranch"],
      ["filing:edit-return-reason", "returnReason"],
      ["filing:edit-memo-date", "memoDate"],
      ["filing:edit-notice-date", "noticeDate"],
      ["filing:edit-service-date", "serviceDate"],
      ["filing:edit-part-payment", "partPayment"],
    ];
    for (const [buttonPayload, expected] of cases) {
      expect(parseFilingChequeEditFieldSelection({ buttonPayload })).toBe(expected);
    }
  });

  it("returns null without a stable ID — no text fallback for this list-picker-only selection", () => {
    expect(parseFilingChequeEditFieldSelection({ body: "cheque number" })).toBeNull();
  });
});

describe("parseFilingNarrativeEditFieldSelection (2-level edit picker, level 2 — narrative group)", () => {
  it("resolves all 3 fields by stable ButtonPayload", () => {
    expect(parseFilingNarrativeEditFieldSelection({ buttonPayload: "filing:edit-story" })).toBe("story");
    expect(parseFilingNarrativeEditFieldSelection({ buttonPayload: "filing:edit-witness" })).toBe("witness");
    expect(parseFilingNarrativeEditFieldSelection({ buttonPayload: "filing:edit-court" })).toBe("court");
  });

  it("returns null without a stable ID", () => {
    expect(parseFilingNarrativeEditFieldSelection({ body: "story" })).toBeNull();
  });
});

describe("parseFilingDeclareAction", () => {
  it.each([
    ["1", "filing:declare-accept"],
    ["i declare", "filing:declare-accept"],
    ["2", "filing:save-exit"],
    ["save and exit", "filing:save-exit"],
  ])("recognizes %s as %s", (value, expected) => {
    expect(parseFilingDeclareAction({ body: value })).toBe(expected);
  });

  it("returns null for unrecognized input", () => {
    expect(parseFilingDeclareAction({ body: "asdf" })).toBeNull();
  });
});
