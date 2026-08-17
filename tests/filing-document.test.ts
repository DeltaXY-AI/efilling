import { describe, expect, it } from "vitest";
import {
  DOCUMENT_GROUP_LIMITS,
  DOCUMENT_GROUP_ORDER,
  MAX_DOCUMENT_BYTES,
  SAMPLE_DOCUMENTS,
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

  it.each(["sample", "Sample", "sample files", "add sample files", "demo", "demo files", "സാമ്പിൾ", "സാമ്പിൾ ഫയലുകൾ"])(
    "recognizes typed %s as the sample-files testing shortcut",
    (value) => {
      expect(parseFilingDocumentAction({ body: value })).toBe("docs:use-sample-files");
    },
  );

  it("the sample-files shortcut has no stable button — an unrelated ButtonPayload never falls through to it", () => {
    expect(parseFilingDocumentAction({ buttonPayload: "docs:unknown", body: "sample" })).toBeNull();
  });
});

describe("SAMPLE_DOCUMENTS", () => {
  it("has at least one fixed demo file for every real upload group", () => {
    for (const group of DOCUMENT_GROUP_ORDER) {
      expect(SAMPLE_DOCUMENTS[group].length).toBeGreaterThan(0);
    }
  });

  it("never uses a real-looking storage host, so nothing downstream mistakes a sample for a real Blob object", () => {
    for (const group of Object.keys(SAMPLE_DOCUMENTS) as (keyof typeof SAMPLE_DOCUMENTS)[]) {
      for (const doc of SAMPLE_DOCUMENTS[group]) {
        expect(doc.storageUrl).toContain("demo.internal.efiling");
        expect(isAllowedContentType(doc.contentType)).toBe(true);
      }
    }
  });

  it("cheque group's sample count never exceeds its own max (2)", () => {
    expect(SAMPLE_DOCUMENTS.cheque.length).toBeLessThanOrEqual(DOCUMENT_GROUP_LIMITS.cheque.max);
  });
});
