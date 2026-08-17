import { describe, expect, it } from "vitest";
import {
  OTHER_CASE_TYPE_DESTINATION,
  otherCaseTypeFromAction,
  parseCaseTypeAction,
  parseOtherCaseTypesAction,
} from "../src/domain/case-type";

describe("parseCaseTypeAction", () => {
  it("resolves a stable ButtonPayload for either option", () => {
    expect(parseCaseTypeAction({ buttonPayload: "filing:case-type-cheque" })).toBe("filing:case-type-cheque");
    expect(parseCaseTypeAction({ buttonPayload: "filing:case-type-other" })).toBe("filing:case-type-other");
  });

  it("an unrecognized stable ButtonPayload never falls through to text matching", () => {
    expect(parseCaseTypeAction({ buttonPayload: "menu:file-case", body: "1" })).toBeNull();
  });

  it("resolves numbered and titled text fallbacks, case-insensitively", () => {
    expect(parseCaseTypeAction({ body: "1" })).toBe("filing:case-type-cheque");
    expect(parseCaseTypeAction({ body: "Cheque Bounce (S.138)" })).toBe("filing:case-type-cheque");
    expect(parseCaseTypeAction({ body: "2" })).toBe("filing:case-type-other");
    expect(parseCaseTypeAction({ body: "OTHER CASE TYPES" })).toBe("filing:case-type-other");
  });

  it("resolves the Malayalam title", () => {
    expect(parseCaseTypeAction({ body: "ചെക്ക് മടങ്ങൽ" })).toBe("filing:case-type-cheque");
    expect(parseCaseTypeAction({ body: "മറ്റ് കേസ് തരങ്ങൾ" })).toBe("filing:case-type-other");
  });

  it("returns null for unrecognized input", () => {
    expect(parseCaseTypeAction({ body: "asdf" })).toBeNull();
    expect(parseCaseTypeAction({})).toBeNull();
  });
});

describe("parseOtherCaseTypesAction", () => {
  it("resolves a stable ButtonPayload/ListId for all 5 items", () => {
    expect(parseOtherCaseTypesAction({ buttonPayload: "filing:case-type-cheque" })).toBe("filing:case-type-cheque");
    expect(parseOtherCaseTypesAction({ listId: "filing:other-type-money" })).toBe("filing:other-type-money");
    expect(parseOtherCaseTypesAction({ listId: "filing:other-type-rent" })).toBe("filing:other-type-rent");
    expect(parseOtherCaseTypesAction({ listId: "filing:other-type-consumer" })).toBe("filing:other-type-consumer");
    expect(parseOtherCaseTypesAction({ listId: "filing:other-type-matrimonial" })).toBe("filing:other-type-matrimonial");
  });

  it("an unrecognized stable id never falls through to text matching", () => {
    expect(parseOtherCaseTypesAction({ listId: "filing:reason-funds", body: "1" })).toBeNull();
  });

  it("resolves numbered text fallbacks", () => {
    expect(parseOtherCaseTypesAction({ body: "3" })).toBe("filing:other-type-rent");
    expect(parseOtherCaseTypesAction({ body: "rent and eviction" })).toBe("filing:other-type-rent");
  });

  it("returns null for unrecognized input", () => {
    expect(parseOtherCaseTypesAction({ body: "asdf" })).toBeNull();
  });
});

describe("otherCaseTypeFromAction", () => {
  it("extracts the case type from an other-type action", () => {
    expect(otherCaseTypeFromAction("filing:other-type-money")).toBe("money");
    expect(otherCaseTypeFromAction("filing:other-type-rent")).toBe("rent");
    expect(otherCaseTypeFromAction("filing:other-type-consumer")).toBe("consumer");
    expect(otherCaseTypeFromAction("filing:other-type-matrimonial")).toBe("matrimonial");
  });

  it("returns null for the cheque-bounce action (not an 'other' type)", () => {
    expect(otherCaseTypeFromAction("filing:case-type-cheque")).toBeNull();
  });
});

describe("OTHER_CASE_TYPE_DESTINATION", () => {
  it("has an English and Malayalam destination message for all 4 non-cheque types", () => {
    for (const type of ["money", "rent", "consumer", "matrimonial"] as const) {
      expect(OTHER_CASE_TYPE_DESTINATION[type].en.length).toBeGreaterThan(0);
      expect(OTHER_CASE_TYPE_DESTINATION[type].ml.length).toBeGreaterThan(0);
    }
  });
});
