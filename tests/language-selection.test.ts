import { describe, expect, it } from "vitest";
import { isLanguageChangeRequest, parseLanguageSelection } from "../src/domain/language-selection";

describe("parseLanguageSelection", () => {
  it.each([
    ["language:en", "en"],
    ["English", "en"],
    ["1", "en"],
    ["language:ml", "ml"],
    ["Malayalam", "ml"],
    ["മലയാളം", "ml"],
    ["2", "ml"],
  ])("recognizes %s as %s", (value, expected) => {
    expect(parseLanguageSelection({ body: value })).toBe(expected);
  });

  it("prefers ButtonPayload over ButtonText and Body", () => {
    const selected = parseLanguageSelection({
      buttonPayload: "language:ml",
      buttonText: "English",
      body: "1",
    });
    expect(selected).toBe("ml");
  });

  it("falls back to ButtonText when there is no ButtonPayload", () => {
    expect(parseLanguageSelection({ buttonText: "Malayalam", body: "1" })).toBe("ml");
  });

  it("trims surrounding whitespace and ignores Latin case", () => {
    expect(parseLanguageSelection({ body: "  ENGLISH  " })).toBe("en");
  });

  it("returns null for unrecognized input, without fuzzy matching", () => {
    expect(parseLanguageSelection({ body: "Englishh" })).toBeNull();
    expect(parseLanguageSelection({ body: "" })).toBeNull();
    expect(parseLanguageSelection({})).toBeNull();
  });
});

describe("isLanguageChangeRequest", () => {
  it.each(["language", "LANGUAGE", "ഭാഷ", " language "])("recognizes %s", (value) => {
    expect(isLanguageChangeRequest({ body: value })).toBe(true);
  });

  it("returns false for anything else", () => {
    expect(isLanguageChangeRequest({ body: "Hi" })).toBe(false);
    expect(isLanguageChangeRequest({ body: "English" })).toBe(false);
  });
});
