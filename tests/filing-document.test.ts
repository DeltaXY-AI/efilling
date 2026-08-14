import { describe, expect, it } from "vitest";
import {
  DOCUMENT_GROUP_LIMITS,
  MAX_DOCUMENT_BYTES,
  hasMetMinimum,
  isAllowedContentType,
  parseFilingDocumentAction,
  wouldExceedMaximum,
} from "../src/domain/filing-document";

describe("DOCUMENT_GROUP_LIMITS", () => {
  it("matches the exact per-group min/max from issue #31 Part A/E", () => {
    expect(DOCUMENT_GROUP_LIMITS.cheque).toEqual({ min: 1, max: 2 });
    expect(DOCUMENT_GROUP_LIMITS.memo).toEqual({ min: 1, max: 2 });
    expect(DOCUMENT_GROUP_LIMITS.notice).toEqual({ min: 1, max: 5 });
    expect(DOCUMENT_GROUP_LIMITS.id).toEqual({ min: 1, max: 2 });
    expect(DOCUMENT_GROUP_LIMITS.support).toEqual({ min: 0, max: 2 });
  });
});

describe("hasMetMinimum / wouldExceedMaximum", () => {
  it("cheque requires at least 1 file", () => {
    expect(hasMetMinimum("cheque", 0)).toBe(false);
    expect(hasMetMinimum("cheque", 1)).toBe(true);
  });

  it("support (optional) is satisfied by zero files", () => {
    expect(hasMetMinimum("support", 0)).toBe(true);
  });

  it("flags exceeding the max before the file is added", () => {
    expect(wouldExceedMaximum("cheque", 1)).toBe(false);
    expect(wouldExceedMaximum("cheque", 2)).toBe(true);
    expect(wouldExceedMaximum("notice", 4)).toBe(false);
    expect(wouldExceedMaximum("notice", 5)).toBe(true);
  });
});

describe("isAllowedContentType", () => {
  it.each(["image/jpeg", "image/png", "application/pdf", "IMAGE/JPEG"])("accepts %s", (contentType) => {
    expect(isAllowedContentType(contentType)).toBe(true);
  });

  it.each(["image/heic", "audio/ogg", "video/mp4", "application/msword", ""])("rejects %s", (contentType) => {
    expect(isAllowedContentType(contentType)).toBe(false);
  });
});

describe("MAX_DOCUMENT_BYTES", () => {
  it("is 10 MB, per the confirmed scope decision", () => {
    expect(MAX_DOCUMENT_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("parseFilingDocumentAction", () => {
  it.each(["done", "Done", "continue", "Continue", "skip", "Skip", "കഴിഞ്ഞു", "തുടരുക", "ഒഴിവാക്കുക"])(
    "recognizes typed %s",
    (value) => {
      expect(parseFilingDocumentAction({ body: value })).toBe("docs:continue");
    },
  );

  it("recognizes the stable ButtonPayload", () => {
    expect(parseFilingDocumentAction({ buttonPayload: "docs:continue" })).toBe("docs:continue");
  });

  it("prioritizes the stable ButtonPayload over Body text", () => {
    expect(parseFilingDocumentAction({ buttonPayload: "docs:unknown", body: "done" })).toBeNull();
  });

  it("returns null for unrecognized input, without fuzzy matching", () => {
    expect(parseFilingDocumentAction({ body: "donee" })).toBeNull();
    expect(parseFilingDocumentAction({})).toBeNull();
    expect(parseFilingDocumentAction({ body: "" })).toBeNull();
  });
});
