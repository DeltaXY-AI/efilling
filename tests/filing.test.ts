import { describe, expect, it } from "vitest";
import { parseDraftChoiceAction, parseFilingNoticeAction } from "../src/domain/filing";

describe("parseDraftChoiceAction", () => {
  it.each([
    ["1", "filing:resume-draft"],
    ["Resume draft", "filing:resume-draft"],
    ["ഡ്രാഫ്റ്റ് തുടരുക", "filing:resume-draft"],
    ["2", "filing:start-new"],
    ["Start new filing", "filing:start-new"],
    ["പുതിയ ഫയലിംഗ് ആരംഭിക്കുക", "filing:start-new"],
    ["3", "nav:main-menu"],
    ["Main menu", "nav:main-menu"],
    ["പ്രധാന മെനു", "nav:main-menu"],
  ])("recognizes typed %s as %s", (value, expected) => {
    expect(parseDraftChoiceAction({ body: value })).toBe(expected);
  });

  it.each(["filing:resume-draft", "filing:start-new", "nav:main-menu"])("recognizes the stable ButtonPayload %s", (stableId) => {
    expect(parseDraftChoiceAction({ buttonPayload: stableId })).toBe(stableId);
  });

  it("treats an unrecognized/stale stable ID as unrecognized, never falling through to a Body match", () => {
    expect(parseDraftChoiceAction({ buttonPayload: "filing:unknown-action", body: "1" })).toBeNull();
  });

  it("falls back to ButtonText when Body does not match", () => {
    expect(parseDraftChoiceAction({ body: "not recognized", buttonText: "Resume draft" })).toBe("filing:resume-draft");
  });

  it("trims whitespace and ignores Latin case", () => {
    expect(parseDraftChoiceAction({ body: "  RESUME DRAFT  " })).toBe("filing:resume-draft");
  });

  it("returns null for unrecognized input, without fuzzy matching", () => {
    expect(parseDraftChoiceAction({ body: "Resume drafts" })).toBeNull();
    expect(parseDraftChoiceAction({})).toBeNull();
  });
});

describe("parseFilingNoticeAction", () => {
  it.each([
    ["1", "filing:accept-test-notice"],
    ["Continue", "filing:accept-test-notice"],
    ["തുടരുക", "filing:accept-test-notice"],
    ["2", "nav:main-menu"],
    ["Main menu", "nav:main-menu"],
    ["പ്രധാന മെനു", "nav:main-menu"],
  ])("recognizes typed %s as %s", (value, expected) => {
    expect(parseFilingNoticeAction({ body: value })).toBe(expected);
  });

  it.each(["filing:accept-test-notice", "nav:main-menu"])("recognizes the stable ButtonPayload %s", (stableId) => {
    expect(parseFilingNoticeAction({ buttonPayload: stableId })).toBe(stableId);
  });

  it("treats an unrecognized/stale stable ID as unrecognized, never falling through to a Body match", () => {
    expect(parseFilingNoticeAction({ buttonPayload: "filing:unknown-action", body: "1" })).toBeNull();
  });

  it("returns null for unrecognized input, without fuzzy matching", () => {
    expect(parseFilingNoticeAction({ body: "Continues" })).toBeNull();
    expect(parseFilingNoticeAction({})).toBeNull();
  });

  it("does not accept draft-choice-only actions (filing:resume-draft/filing:start-new)", () => {
    expect(parseFilingNoticeAction({ buttonPayload: "filing:resume-draft" })).toBeNull();
    expect(parseFilingNoticeAction({ buttonPayload: "filing:start-new" })).toBeNull();
  });
});
