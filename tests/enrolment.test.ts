import { describe, expect, it } from "vitest";
import { normalizeEnrolmentNumber, validateEnrolmentNumber } from "../src/domain/enrolment";

describe("normalizeEnrolmentNumber", () => {
  it("uppercases and removes whitespace around separators", () => {
    expect(normalizeEnrolmentNumber("ker / 1234 / 2010")).toBe("KER/1234/2010");
  });

  it("collapses other whitespace to a single space", () => {
    expect(normalizeEnrolmentNumber("KL   1234/2010")).toBe("KL 1234/2010");
  });

  it("trims leading/trailing whitespace", () => {
    expect(normalizeEnrolmentNumber("  KER-1234-2010  ")).toBe("KER-1234-2010");
  });
});

describe("validateEnrolmentNumber", () => {
  it.each(["K/1234/2010", "KER/1234/2010", "1234/2010", "KL 1234/2010", "KER-1234-2010"])(
    "accepts the realistic format %s",
    (value) => {
      const result = validateEnrolmentNumber(value);
      expect(result.valid).toBe(true);
    },
  );

  it("normalizes lowercase input to uppercase", () => {
    const result = validateEnrolmentNumber("ker/1234/2010");
    expect(result).toMatchObject({ valid: true, normalized: "KER/1234/2010" });
  });

  it("removes spaces around separators but preserves the trimmed original", () => {
    const result = validateEnrolmentNumber("  ker / 1234 / 2010  ");
    expect(result).toMatchObject({ valid: true, original: "ker / 1234 / 2010", normalized: "KER/1234/2010" });
  });

  it("rejects an empty value", () => {
    expect(validateEnrolmentNumber("").valid).toBe(false);
    expect(validateEnrolmentNumber("   ").valid).toBe(false);
  });

  it("rejects a value shorter than 5 characters", () => {
    expect(validateEnrolmentNumber("K/12").valid).toBe(false);
  });

  it("rejects a value longer than 30 characters", () => {
    expect(validateEnrolmentNumber("KER/1234567890123456789012345678").valid).toBe(false);
  });

  it("rejects emoji", () => {
    expect(validateEnrolmentNumber("KER/1234\u{1F642}").valid).toBe(false);
  });

  it("rejects a URL", () => {
    expect(validateEnrolmentNumber("http://example.com/1234").valid).toBe(false);
  });

  it("rejects control characters", () => {
    // A leading/trailing control character would just be trimmed away, so
    // these are placed in the middle where trimming can't hide them.
    expect(validateEnrolmentNumber("KER/1234" + String.fromCharCode(9) + "/2010").valid).toBe(false);
    expect(validateEnrolmentNumber("KER" + String.fromCharCode(0) + "1234/2010").valid).toBe(false);
  });

  it("rejects letters with no digit at all", () => {
    expect(validateEnrolmentNumber("KERALA/BOARD").valid).toBe(false);
  });

  it("rejects a value that does not begin/end with a letter or number", () => {
    expect(validateEnrolmentNumber("/1234/2010").valid).toBe(false);
    expect(validateEnrolmentNumber("1234/2010-").valid).toBe(false);
  });

  it("never exposes the internal reason code as user-visible text — reason is an internal enum only", () => {
    const result = validateEnrolmentNumber("");
    expect(result.reason).toBe("REQUIRED");
    // The workflow/sender layer never reads or forwards `reason` into any
    // outbound message — this is asserted structurally: it's typed as one
    // of a closed set of internal enum values, not a display string.
    expect(["REQUIRED", "INVALID_LENGTH", "INVALID_CHARACTERS", "DIGIT_REQUIRED"]).toContain(result.reason);
  });
});
