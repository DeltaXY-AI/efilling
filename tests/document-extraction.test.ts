import { describe, expect, it } from "vitest";
import { extractChequeFields, extractMemoFields, extractNoticeFields, type DocumentExtractionDeps } from "../src/services/document-extraction";

function depsReturning(result: Record<string, unknown> | null): DocumentExtractionDeps {
  return { visionClient: { extractStructured: async () => result } };
}

const BUFFER = Buffer.from("fake-image-bytes");
const CONTENT_TYPE = "image/jpeg";

describe("extractChequeFields", () => {
  it("normalizes every field through the same validators manual entry uses", async () => {
    const result = await extractChequeFields(
      depsReturning({
        chequeNumber: "  004512  ",
        chequeDate: "12-03-2026",
        chequeAmount: "₹45,000",
        bankBranch: "  State Bank, Kollam  ",
        accusedName: "  Rajesh Menon  ",
      }),
      BUFFER,
      CONTENT_TYPE,
    );
    expect(result).toEqual({
      chequeNumber: "004512",
      chequeDate: "2026-03-12",
      chequeAmount: "45000",
      bankBranch: "State Bank, Kollam",
      accusedName: "Rajesh Menon",
    });
  });

  it("omits a field the model returned that doesn't pass validation, rather than storing it anyway", async () => {
    const result = await extractChequeFields(
      depsReturning({ chequeNumber: "004512", chequeDate: "31-02-2026", chequeAmount: "not a number" }),
      BUFFER,
      CONTENT_TYPE,
    );
    expect(result).toEqual({ chequeNumber: "004512" });
  });

  it("returns {} (never null or a throw) when the vision client itself returns null", async () => {
    const result = await extractChequeFields(depsReturning(null), BUFFER, CONTENT_TYPE);
    expect(result).toEqual({});
  });

  it("returns {} when the vision client's fields are all missing/blank", async () => {
    const result = await extractChequeFields(depsReturning({}), BUFFER, CONTENT_TYPE);
    expect(result).toEqual({});
  });
});

describe("extractMemoFields", () => {
  it("maps free-form return-reason text onto this app's fixed enum", async () => {
    const result = await extractMemoFields(depsReturning({ returnReason: "Funds Insufficient", memoDate: "13-03-2026" }), BUFFER, CONTENT_TYPE);
    expect(result).toEqual({ returnReason: "funds", memoDate: "2026-03-13" });
  });

  it("omits returnReason when the model's text doesn't match any known reason", async () => {
    const result = await extractMemoFields(depsReturning({ returnReason: "Some unrelated note", memoDate: "13-03-2026" }), BUFFER, CONTENT_TYPE);
    expect(result).toEqual({ memoDate: "2026-03-13" });
  });

  it("returns {} when the vision client returns null", async () => {
    const result = await extractMemoFields(depsReturning(null), BUFFER, CONTENT_TYPE);
    expect(result).toEqual({});
  });
});

describe("extractNoticeFields", () => {
  it("normalizes both dates through validateFilingDate", async () => {
    const result = await extractNoticeFields(depsReturning({ noticeDate: "25-03-2026", serviceDate: "28-03-2026" }), BUFFER, CONTENT_TYPE);
    expect(result).toEqual({ noticeDate: "2026-03-25", serviceDate: "2026-03-28" });
  });

  it("omits an unparseable date rather than storing the model's raw text", async () => {
    const result = await extractNoticeFields(depsReturning({ noticeDate: "not a date", serviceDate: "28-03-2026" }), BUFFER, CONTENT_TYPE);
    expect(result).toEqual({ serviceDate: "2026-03-28" });
  });

  it("returns {} when the vision client returns null", async () => {
    const result = await extractNoticeFields(depsReturning(null), BUFFER, CONTENT_TYPE);
    expect(result).toEqual({});
  });
});
