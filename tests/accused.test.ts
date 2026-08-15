import { describe, expect, it } from "vitest";
import { parseAccusedConfirmAction, parseAccusedEditFieldAction, parseEntityTypeSelection, validateAccusedPhone } from "../src/domain/accused";
import { validateAddress, validatePersonName } from "../src/domain/complainant";

describe("validateAccusedPhone", () => {
  it("accepts a valid Indian local number, normalizing to E.164", () => {
    expect(validateAccusedPhone("9876543210")).toMatchObject({ valid: true, original: "9876543210", normalized: "+919876543210" });
  });

  it("accepts valid E.164 input directly", () => {
    expect(validateAccusedPhone("+919876543210")).toMatchObject({ valid: true, normalized: "+919876543210" });
  });

  it.each(["skip", "Skip", "ഒഴിവാക്കുക"])("recognizes the exact skip command %s, storing both fields null", (value) => {
    expect(validateAccusedPhone(value)).toMatchObject({ valid: true, original: null, normalized: null });
  });

  it("does not fuzzy-match arbitrary text to Skip", () => {
    expect(validateAccusedPhone("skipthis").valid).toBe(false);
  });

  it("rejects an impossible/invalid number", () => {
    expect(validateAccusedPhone("12345")).toMatchObject({ valid: false, reason: "INVALID", original: null, normalized: null });
  });

  it("rejects a number embedded in prose, rather than extracting it", () => {
    expect(validateAccusedPhone("call me at 9876543210").valid).toBe(false);
  });

  it("never marks the result as verified — there is no such field at all", () => {
    const result = validateAccusedPhone("9876543210");
    expect(result).not.toHaveProperty("verified");
  });

  it("reuses #10's validatePersonName/validateAddress unchanged (no forked validation)", () => {
    // Sanity check that the shared validators imported by accused-workflow.ts
    // behave identically for the accused party — this is not a second
    // implementation (#11 Part C).
    expect(validatePersonName("Rajesh Menon")).toMatchObject({ valid: true, normalized: "Rajesh Menon" });
    expect(validateAddress("32/1147, Menon Villa\nChinnakada, Kollam 691001").valid).toBe(true);
  });

  it("accepts initials and business/legal names for the accused full/legal name (#11 Part C)", () => {
    expect(validatePersonName("R.K. Menon").valid).toBe(true);
    expect(validatePersonName("M/s Menon & Sons Pvt. Ltd.").valid).toBe(true);
    expect(validatePersonName("Menon Traders, Kollam Branch").valid).toBe(true);
  });
});

describe("parseAccusedConfirmAction", () => {
  it.each([
    ["1", "accused:confirm"],
    ["Confirm", "accused:confirm"],
    ["സ്ഥിരീകരിക്കുക", "accused:confirm"],
    ["2", "accused:edit"],
    ["Edit", "accused:edit"],
    ["എഡിറ്റ് ചെയ്യുക", "accused:edit"],
    ["3", "filing:save-exit"],
    ["Save and exit", "filing:save-exit"],
    ["സേവ് ചെയ്ത് പുറത്തുപോകുക", "filing:save-exit"],
  ])("recognizes typed %s as %s", (value, expected) => {
    expect(parseAccusedConfirmAction({ body: value })).toBe(expected);
  });

  it.each(["accused:confirm", "accused:edit", "filing:save-exit"])("recognizes the stable ButtonPayload %s", (stableId) => {
    expect(parseAccusedConfirmAction({ buttonPayload: stableId })).toBe(stableId);
  });

  it("treats an unrecognized/stale stable ID as unrecognized, never falling through to a Body match", () => {
    expect(parseAccusedConfirmAction({ buttonPayload: "accused:unknown-action", body: "1" })).toBeNull();
  });

  it("returns null for unrecognized input, without fuzzy matching", () => {
    expect(parseAccusedConfirmAction({ body: "Confirms" })).toBeNull();
    expect(parseAccusedConfirmAction({})).toBeNull();
  });
});

describe("parseAccusedEditFieldAction", () => {
  it.each([
    ["1", "accused:edit-name"],
    ["Full/legal name", "accused:edit-name"],
    ["2", "accused:edit-phone"],
    ["Phone number", "accused:edit-phone"],
    ["3", "accused:edit-address"],
    ["Address", "accused:edit-address"],
    ["വിലാസം", "accused:edit-address"],
    // #33 Part B appends entity type as the 4th option.
    ["4", "accused:edit-entity-type"],
    ["Entity type", "accused:edit-entity-type"],
    ["സ്ഥാപന തരം", "accused:edit-entity-type"],
  ])("recognizes typed %s as %s", (value, expected) => {
    expect(parseAccusedEditFieldAction({ body: value })).toBe(expected);
  });

  it.each(["accused:edit-name", "accused:edit-phone", "accused:edit-address", "accused:edit-entity-type"])(
    "recognizes the stable ListId %s",
    (stableId) => {
      expect(parseAccusedEditFieldAction({ listId: stableId })).toBe(stableId);
    },
  );

  it("returns null for unrecognized input, without fuzzy matching", () => {
    expect(parseAccusedEditFieldAction({ body: "Full names" })).toBeNull();
    expect(parseAccusedEditFieldAction({})).toBeNull();
  });
});

describe("parseEntityTypeSelection (#33 Part B)", () => {
  it.each([
    ["1", "INDIVIDUAL"],
    ["Individual", "INDIVIDUAL"],
    ["വ്യക്തി", "INDIVIDUAL"],
    ["2", "PROPRIETOR"],
    ["Proprietor of a firm", "PROPRIETOR"],
    ["3", "COMPANY"],
    ["Company/partnership", "COMPANY"],
  ])("recognizes typed %s as %s", (value, expected) => {
    expect(parseEntityTypeSelection({ body: value })).toBe(expected);
  });

  it.each(["accused:entity-individual", "accused:entity-proprietor", "accused:entity-company"])(
    "recognizes the stable ButtonPayload %s",
    (stableId) => {
      expect(parseEntityTypeSelection({ buttonPayload: stableId })).not.toBeNull();
    },
  );

  it("returns null for unrecognized input, without fuzzy matching", () => {
    expect(parseEntityTypeSelection({ body: "Individually" })).toBeNull();
    expect(parseEntityTypeSelection({})).toBeNull();
  });
});
