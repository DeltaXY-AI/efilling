import { describe, expect, it } from "vitest";
import {
  normalizeAddress,
  normalizePersonName,
  parseComplainantConfirmAction,
  parseComplainantEditFieldAction,
  validateAddress,
  validateEmail,
  validatePersonName,
  validatePhoneNumber,
} from "../src/domain/complainant";

describe("normalizePersonName", () => {
  it("collapses runs of spaces/tabs to a single space and trims", () => {
    expect(normalizePersonName("  Anitha   Joseph  ")).toBe("Anitha Joseph");
    expect(normalizePersonName("Anitha\tJoseph")).toBe("Anitha Joseph");
  });

  it("preserves Malayalam script untouched", () => {
    expect(normalizePersonName("  അനിത ജോസഫ്  ")).toBe("അനിത ജോസഫ്");
  });
});

describe("validatePersonName", () => {
  it("accepts a valid English name", () => {
    expect(validatePersonName("Anitha Joseph")).toMatchObject({ valid: true, normalized: "Anitha Joseph" });
  });

  it("accepts a valid Malayalam name", () => {
    expect(validatePersonName("അനിത ജോസഫ്")).toMatchObject({ valid: true, normalized: "അനിത ജോസഫ്" });
  });

  it("collapses unnecessary horizontal whitespace before validating", () => {
    expect(validatePersonName("  Anitha    Joseph  ")).toMatchObject({ valid: true, normalized: "Anitha Joseph" });
  });

  it("rejects an empty/whitespace-only value", () => {
    expect(validatePersonName("").valid).toBe(false);
    expect(validatePersonName("   ").valid).toBe(false);
    expect(validatePersonName("").reason).toBe("REQUIRED");
  });

  it("rejects a name shorter than 2 characters", () => {
    expect(validatePersonName("A")).toMatchObject({ valid: false, reason: "INVALID_LENGTH" });
  });

  it("rejects a name longer than 120 characters", () => {
    expect(validatePersonName("A".repeat(121))).toMatchObject({ valid: false, reason: "INVALID_LENGTH" });
  });

  it("rejects line breaks in a name", () => {
    expect(validatePersonName("Anitha\nJoseph")).toMatchObject({ valid: false, reason: "INVALID_CHARACTERS" });
    expect(validatePersonName("Anitha\r\nJoseph")).toMatchObject({ valid: false, reason: "INVALID_CHARACTERS" });
  });

  it("rejects other control characters", () => {
    expect(validatePersonName("Anitha" + String.fromCharCode(0) + "Joseph")).toMatchObject({ valid: false, reason: "INVALID_CHARACTERS" });
  });

  it("does not restrict names to Latin letters (emoji is not rejected by charset alone)", () => {
    expect(validatePersonName("Anitha 😀").valid).toBe(true);
  });
});

describe("validatePhoneNumber", () => {
  it("accepts a valid Indian local number, normalizing to E.164 with default country IN", () => {
    expect(validatePhoneNumber("9876543210")).toMatchObject({ valid: true, original: "9876543210", normalized: "+919876543210" });
  });

  it("accepts E.164 input directly, preserved canonically", () => {
    expect(validatePhoneNumber("+919876543210")).toMatchObject({ valid: true, normalized: "+919876543210" });
  });

  it("trims surrounding whitespace while preserving the original", () => {
    expect(validatePhoneNumber("  +91 98765 43210  ")).toMatchObject({ valid: true, original: "+91 98765 43210", normalized: "+919876543210" });
  });

  it("rejects an empty value", () => {
    expect(validatePhoneNumber("").valid).toBe(false);
    expect(validatePhoneNumber("").reason).toBe("REQUIRED");
  });

  it("rejects an impossible/invalid number", () => {
    expect(validatePhoneNumber("12345")).toMatchObject({ valid: false, reason: "INVALID" });
    expect(validatePhoneNumber("0000000000")).toMatchObject({ valid: false, reason: "INVALID" });
  });

  it("rejects non-numeric input", () => {
    expect(validatePhoneNumber("not-a-phone-number").valid).toBe(false);
  });

  it("rejects a number embedded in prose, rather than extracting it — the whole input must BE the number", () => {
    // libphonenumber-js's raw parser would happily extract "9876543210" from
    // this and call it valid; the surrounding words must still fail it.
    expect(validatePhoneNumber("call me at 9876543210").valid).toBe(false);
    expect(validatePhoneNumber("my number is 9876543210, thanks").valid).toBe(false);
  });

  it("accepts realistic formatting punctuation (dashes, parentheses, spaces)", () => {
    expect(validatePhoneNumber("+91-98765-43210")).toMatchObject({ valid: true, normalized: "+919876543210" });
    expect(validatePhoneNumber("(+91) 98765 43210")).toMatchObject({ valid: true, normalized: "+919876543210" });
  });

  it("never marks the result as verified — there is no such field at all", () => {
    const result = validatePhoneNumber("9876543210");
    expect(result).not.toHaveProperty("verified");
  });
});

describe("validateEmail", () => {
  it("accepts a valid email, normalizing only the domain to lowercase", () => {
    expect(validateEmail("Anitha.Joseph@Example.COM")).toMatchObject({ valid: true, normalized: "Anitha.Joseph@example.com" });
  });

  it("trims surrounding whitespace", () => {
    expect(validateEmail("  anitha@example.com  ")).toMatchObject({ valid: true, normalized: "anitha@example.com" });
  });

  it.each(["skip", "Skip", "ഒഴിവാക്കുക"])("recognizes the exact skip command %s, producing normalized: null", (value) => {
    expect(validateEmail(value)).toMatchObject({ valid: true, normalized: null });
  });

  it("does not fuzzy-match arbitrary text to Skip", () => {
    expect(validateEmail("skipthis").valid).toBe(false);
    expect(validateEmail("please skip").valid).toBe(false);
  });

  it("rejects an invalid email", () => {
    expect(validateEmail("not-an-email")).toMatchObject({ valid: false, reason: "INVALID", normalized: null });
  });
});

describe("normalizeAddress", () => {
  it("normalizes CRLF and CR to LF while preserving line breaks", () => {
    expect(normalizeAddress("Line one\r\nLine two\rLine three")).toBe("Line one\nLine two\nLine three");
  });

  it("collapses horizontal whitespace on each line without merging lines", () => {
    expect(normalizeAddress("  Line   one  \n  Line   two  ")).toBe("Line one\nLine two");
  });
});

describe("validateAddress", () => {
  it("accepts a valid multiline Unicode address, preserving line breaks", () => {
    const result = validateAddress("Thekkumkattil House\nKadappakada, Kollam 691008");
    expect(result).toMatchObject({ valid: true, normalized: "Thekkumkattil House\nKadappakada, Kollam 691008" });
  });

  it("accepts Malayalam address text", () => {
    expect(validateAddress("തേക്കുംകാട്ടിൽ ഹൗസ്\nകടപ്പാക്കട, കൊല്ലം 691008").valid).toBe(true);
  });

  it("rejects an empty value", () => {
    expect(validateAddress("").valid).toBe(false);
    expect(validateAddress("").reason).toBe("REQUIRED");
  });

  it("rejects an address shorter than 10 characters", () => {
    expect(validateAddress("short")).toMatchObject({ valid: false, reason: "INVALID_LENGTH" });
  });

  it("rejects an address longer than 500 characters", () => {
    expect(validateAddress("A".repeat(501))).toMatchObject({ valid: false, reason: "INVALID_LENGTH" });
  });

  it("rejects disallowed control characters while permitting line breaks", () => {
    expect(validateAddress("Valid address line one\nValid line two" + String.fromCharCode(0))).toMatchObject({
      valid: false,
      reason: "INVALID_CHARACTERS",
    });
  });
});

describe("parseComplainantConfirmAction", () => {
  it.each([
    ["1", "complainant:confirm"],
    ["Confirm", "complainant:confirm"],
    ["സ്ഥിരീകരിക്കുക", "complainant:confirm"],
    ["2", "complainant:edit"],
    ["Edit", "complainant:edit"],
    ["എഡിറ്റ് ചെയ്യുക", "complainant:edit"],
    ["3", "filing:save-exit"],
    ["Save and exit", "filing:save-exit"],
    ["സേവ് ചെയ്ത് പുറത്തുപോകുക", "filing:save-exit"],
  ])("recognizes typed %s as %s", (value, expected) => {
    expect(parseComplainantConfirmAction({ body: value })).toBe(expected);
  });

  it.each(["complainant:confirm", "complainant:edit", "filing:save-exit"])("recognizes the stable ButtonPayload %s", (stableId) => {
    expect(parseComplainantConfirmAction({ buttonPayload: stableId })).toBe(stableId);
  });

  it("treats an unrecognized/stale stable ID as unrecognized, never falling through to a Body match", () => {
    expect(parseComplainantConfirmAction({ buttonPayload: "complainant:unknown-action", body: "1" })).toBeNull();
  });

  it("returns null for unrecognized input, without fuzzy matching", () => {
    expect(parseComplainantConfirmAction({ body: "Confirms" })).toBeNull();
    expect(parseComplainantConfirmAction({})).toBeNull();
  });
});

describe("parseComplainantEditFieldAction", () => {
  it.each([
    ["1", "complainant:edit-name"],
    ["Full name", "complainant:edit-name"],
    ["പൂർണ്ണ പേര്", "complainant:edit-name"],
    ["2", "complainant:edit-phone"],
    ["Phone number", "complainant:edit-phone"],
    ["ഫോൺ നമ്പർ", "complainant:edit-phone"],
    ["3", "complainant:edit-email"],
    ["Email", "complainant:edit-email"],
    ["ഇമെയിൽ", "complainant:edit-email"],
    ["4", "complainant:edit-address"],
    ["Address", "complainant:edit-address"],
    ["വിലാസം", "complainant:edit-address"],
  ])("recognizes typed %s as %s", (value, expected) => {
    expect(parseComplainantEditFieldAction({ body: value })).toBe(expected);
  });

  it.each(["complainant:edit-name", "complainant:edit-phone", "complainant:edit-email", "complainant:edit-address"])(
    "recognizes the stable ListId %s",
    (stableId) => {
      expect(parseComplainantEditFieldAction({ listId: stableId })).toBe(stableId);
    },
  );

  it("returns null for unrecognized input, without fuzzy matching", () => {
    expect(parseComplainantEditFieldAction({ body: "Full names" })).toBeNull();
    expect(parseComplainantEditFieldAction({})).toBeNull();
  });
});
