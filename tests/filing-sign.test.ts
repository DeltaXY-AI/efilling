import { describe, expect, it } from "vitest";
import { isValidOtpFormat, parseDraftReadyAction } from "../src/domain/filing-sign";

/** Covers #34 (Prototype parity — Phase 6): the draft-ready action parser and the OTP format check. */
describe("parseDraftReadyAction", () => {
  it("resolves a stable-ID button tap for e-Sign", () => {
    expect(parseDraftReadyAction({ buttonPayload: "filing:esign" })).toBe("filing:esign");
  });

  it("resolves a stable-ID button tap for edit details", () => {
    expect(parseDraftReadyAction({ buttonPayload: "filing:edit-details" })).toBe("filing:edit-details");
  });

  it("an unrecognized stable ID is never a fallback into text matching, even with a matching body", () => {
    expect(parseDraftReadyAction({ buttonPayload: "filing:something-else", body: "1" })).toBeNull();
  });

  it("empty buttonPayload falls through to text matching rather than being treated as a present stable ID", () => {
    expect(parseDraftReadyAction({ buttonPayload: "", body: "1" })).toBe("filing:esign");
  });

  it("accepts the numbered plain-text fallback", () => {
    expect(parseDraftReadyAction({ body: "1" })).toBe("filing:esign");
    expect(parseDraftReadyAction({ body: "2" })).toBe("filing:edit-details");
  });

  it("accepts the exact localized title, case-insensitively", () => {
    expect(parseDraftReadyAction({ body: "Review & e-Sign" })).toBe("filing:esign");
    expect(parseDraftReadyAction({ body: "EDIT DETAILS" })).toBe("filing:edit-details");
    expect(parseDraftReadyAction({ body: "review and e-sign" })).toBe("filing:esign");
  });

  it("falls back to buttonText when body doesn't match", () => {
    expect(parseDraftReadyAction({ body: "asdf", buttonText: "Edit details" })).toBe("filing:edit-details");
  });

  it("returns null for unrecognized input", () => {
    expect(parseDraftReadyAction({ body: "hello" })).toBeNull();
    expect(parseDraftReadyAction({})).toBeNull();
  });
});

describe("isValidOtpFormat", () => {
  it("accepts exactly 6 digits", () => {
    expect(isValidOtpFormat("123456")).toBe(true);
  });

  it("trims surrounding whitespace before checking", () => {
    expect(isValidOtpFormat("  123456  ")).toBe(true);
  });

  it("rejects fewer or more than 6 digits", () => {
    expect(isValidOtpFormat("12345")).toBe(false);
    expect(isValidOtpFormat("1234567")).toBe(false);
  });

  it("rejects non-digit characters", () => {
    expect(isValidOtpFormat("12345a")).toBe(false);
    expect(isValidOtpFormat("123 456")).toBe(false);
    expect(isValidOtpFormat("")).toBe(false);
  });
});
