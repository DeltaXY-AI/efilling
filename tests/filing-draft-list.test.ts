import { describe, expect, it } from "vitest";
import { computeLimitationDeadline, daysUntil, parseDraftDetailAction, parseDraftListSelection } from "../src/domain/filing-draft-list";

/** Covers #36 (Prototype parity — Phase 8): "My cases" — row/action parsing and the limitation-deadline calculation. */
describe("parseDraftListSelection", () => {
  it("resolves a stable-ID positional row (the list-picker's fixed filing:pick-row-N ids)", () => {
    expect(parseDraftListSelection({ listId: "filing:pick-row-3" })).toEqual({ kind: "position", position: 3 });
  });

  it("resolves the fixed nav:main-menu stable ID", () => {
    expect(parseDraftListSelection({ listId: "nav:main-menu" })).toEqual({ kind: "nav-main-menu" });
  });

  it("an unrecognized stable ID is never a fallback into text matching, even with a matching body", () => {
    expect(parseDraftListSelection({ listId: "filing:something-else", body: "1" })).toBeNull();
  });

  it("a non-numeric suffix on the row prefix is rejected, not misread as a position", () => {
    expect(parseDraftListSelection({ listId: "filing:pick-row-abc" })).toBeNull();
  });

  it("empty listId falls through to text matching rather than being treated as a present stable ID", () => {
    expect(parseDraftListSelection({ listId: "", body: "3" })).toEqual({ kind: "position", position: 3 });
  });

  it("accepts a typed number as a position — the same concept a fixed filing:pick-row-N id carries", () => {
    expect(parseDraftListSelection({ body: "7" })).toEqual({ kind: "position", position: 7 });
  });

  it("accepts typed 'main menu' text, case-insensitively", () => {
    expect(parseDraftListSelection({ body: "Main Menu" })).toEqual({ kind: "nav-main-menu" });
  });

  it("returns null for unrecognized text", () => {
    expect(parseDraftListSelection({ body: "hello" })).toBeNull();
    expect(parseDraftListSelection({})).toBeNull();
  });
});

describe("parseDraftDetailAction", () => {
  it("resolves the fixed stable-ID actions — genuinely static content, no per-request id variation", () => {
    expect(parseDraftDetailAction({ buttonPayload: "filing:resume-draft" })).toBe("filing:resume-draft");
    expect(parseDraftDetailAction({ buttonPayload: "filing:discard-draft" })).toBe("filing:discard-draft");
    expect(parseDraftDetailAction({ buttonPayload: "nav:main-menu" })).toBe("nav:main-menu");
  });

  it("an unrecognized stable ID is never a fallback into text matching", () => {
    expect(parseDraftDetailAction({ buttonPayload: "filing:something-else", body: "1" })).toBeNull();
  });

  it("accepts the numbered plain-text fallback", () => {
    expect(parseDraftDetailAction({ body: "1" })).toBe("filing:resume-draft");
    expect(parseDraftDetailAction({ body: "2" })).toBe("filing:discard-draft");
    expect(parseDraftDetailAction({ body: "3" })).toBe("nav:main-menu");
  });

  it("accepts the exact localized title, case-insensitively", () => {
    expect(parseDraftDetailAction({ body: "Continue Filing" })).toBe("filing:resume-draft");
    expect(parseDraftDetailAction({ body: "discard draft" })).toBe("filing:discard-draft");
  });

  it("falls back to buttonText when body doesn't match", () => {
    expect(parseDraftDetailAction({ body: "asdf", buttonText: "Main menu" })).toBe("nav:main-menu");
  });

  it("returns null for unrecognized text", () => {
    expect(parseDraftDetailAction({ body: "hello" })).toBeNull();
  });
});

describe("computeLimitationDeadline", () => {
  it("adds 15 days then 1 calendar month (Scope decision, confirmed)", () => {
    expect(computeLimitationDeadline("2026-03-28")).toBe("2026-05-12");
  });

  it("handles a month-end rollover", () => {
    // Jan 20 + 15 days = Feb 4 (Jan has 31 days); + 1 month = Mar 4.
    expect(computeLimitationDeadline("2026-01-20")).toBe("2026-03-04");
  });
});

describe("daysUntil", () => {
  it("counts whole days remaining", () => {
    expect(daysUntil("2026-05-12", new Date("2026-05-01T00:00:00Z"))).toBe(11);
  });

  it("is zero on the deadline day itself", () => {
    expect(daysUntil("2026-05-12", new Date("2026-05-12T15:00:00Z"))).toBe(0);
  });

  it("is negative once the deadline has passed", () => {
    expect(daysUntil("2026-05-12", new Date("2026-05-15T00:00:00Z"))).toBe(-3);
  });
});
