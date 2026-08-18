import { describe, expect, it } from "vitest";
import { parseFilingFiledAction } from "../src/domain/filing-completion";

/** Covers #35 (Prototype parity — Phase 7): the "Pay court fee" action parser. */
describe("parseFilingFiledAction", () => {
  it("resolves a stable-ID button tap", () => {
    expect(parseFilingFiledAction({ buttonPayload: "filing:pay-fee" })).toBe("filing:pay-fee");
  });

  it("an unrecognized stable ID is never a fallback into text matching, even with a matching body", () => {
    expect(parseFilingFiledAction({ buttonPayload: "filing:something-else", body: "1" })).toBeNull();
  });

  it("empty buttonPayload falls through to text matching rather than being treated as a present stable ID", () => {
    expect(parseFilingFiledAction({ buttonPayload: "", body: "1" })).toBe("filing:pay-fee");
  });

  it("accepts the numbered plain-text fallback", () => {
    expect(parseFilingFiledAction({ body: "1" })).toBe("filing:pay-fee");
  });

  it("accepts the exact localized title, case-insensitively", () => {
    expect(parseFilingFiledAction({ body: "Pay Court Fee" })).toBe("filing:pay-fee");
    expect(parseFilingFiledAction({ body: "pay the court fee" })).toBe("filing:pay-fee");
  });

  it("falls back to buttonText when body doesn't match", () => {
    expect(parseFilingFiledAction({ body: "asdf", buttonText: "Pay fee" })).toBe("filing:pay-fee");
  });

  it("returns null for unrecognized input", () => {
    expect(parseFilingFiledAction({ body: "hello" })).toBeNull();
    expect(parseFilingFiledAction({})).toBeNull();
  });

  it("resolves nav:main-menu by stable ID, the numbered fallback, or its exact title", () => {
    expect(parseFilingFiledAction({ buttonPayload: "nav:main-menu" })).toBe("nav:main-menu");
    expect(parseFilingFiledAction({ body: "2" })).toBe("nav:main-menu");
    expect(parseFilingFiledAction({ body: "Main Menu" })).toBe("nav:main-menu");
  });
});
