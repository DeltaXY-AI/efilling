import { describe, expect, it } from "vitest";
import { PDFParse } from "pdf-parse";
import { feeReceiptPdfFilename, renderFeeReceiptPdf } from "../src/services/fee-receipt-pdf";
import type { FilingRecord } from "../src/repositories/filing-repository";
import type { FilingPartyRecord } from "../src/repositories/filing-party-repository";

const TWILIO_MEDIA_SIZE_LIMIT = 500 * 1024;

function baseFiling(overrides: Partial<FilingRecord> = {}): FilingRecord {
  return {
    id: "filing-1",
    conversationId: "conversation-1",
    role: "COMPLAINANT_ADVOCATE",
    status: "FILED",
    currentStep: "FILING_DONE",
    language: "en",
    testNoticeVersion: "v1",
    testNoticeAcceptedAt: new Date("2026-01-01"),
    advocateEnrolmentOriginal: "KER/1234/2010",
    advocateEnrolmentNormalized: "KER/1234/2010",
    advocateEnrolmentStatus: "RECORDED_UNVERIFIED",
    advocateEnrolmentConfirmedAt: new Date("2026-01-01"),
    chequeNumber: "458219",
    chequeDate: "2026-03-12",
    chequeAmount: "4,50,000",
    bankBranch: "State Bank of India, Kollam Branch",
    returnReason: "funds",
    memoDate: "2026-03-15",
    noticeDate: "2026-03-20",
    serviceDate: "2026-03-28",
    partPayment: false,
    narrative: null,
    witnessPresent: false,
    selectedCourt: "ON Court - I, Kollam",
    declarationAcceptedAt: new Date("2026-04-01"),
    diaryNumber: "TEST-000001-2026",
    filedAt: new Date("2026-04-20T04:32:00Z"),
    courtFeePaidAt: new Date("2026-04-20T04:34:00Z"),
    courtFeeTransactionId: "SIM-A1B2C3D4-5E6F-4A1B-9C3D-1234567890AB",
    defectNotifiedAt: null,
    defectCorrectedChequeNumber: null,
    defectDelayReason: null,
    defectDelayDays: null,
    defectResubmittedAt: null,
    nextHearingDate: null,
    hearingAttendance: null,
    adjournmentGround: null,
    adjournmentRequestedDate: null,
    adjournmentIaNumber: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-04-20"),
    ...overrides,
  };
}

function baseComplainant(overrides: Partial<FilingPartyRecord> = {}): FilingPartyRecord {
  return {
    id: "party-complainant",
    filingId: "filing-1",
    partyRole: "COMPLAINANT",
    fullName: "Anitha Joseph",
    phoneOriginal: null,
    phoneNormalized: null,
    emailNormalized: null,
    address: "Thekkumkattil House, Kollam 691008",
    filingAsRole: "SELF",
    representativeEnrolmentNumber: null,
    entityType: null,
    status: "CONFIRMED",
    confirmedAt: new Date("2026-01-01"),
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

async function extractText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return result.text;
}

describe("renderFeeReceiptPdf", () => {
  it("produces a valid PDF under Twilio's 500 KB non-image media cap", async () => {
    const buffer = await renderFeeReceiptPdf(baseFiling(), baseComplainant());
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.length).toBeLessThan(TWILIO_MEDIA_SIZE_LIMIT);
  });

  it("includes the diary number, complainant name, amount, and transaction ID", async () => {
    const buffer = await renderFeeReceiptPdf(baseFiling(), baseComplainant());
    const text = await extractText(buffer);

    expect(text).toContain("TEST-000001-2026");
    expect(text).toContain("Anitha Joseph");
    expect(text).toContain("Rs. 500");
    expect(text).toContain("SIM-A1B2C3D4-5E6F-4A1B-9C3D-1234567890AB");
    expect(text).toContain("ON Court - I, Kollam");
  });

  it("carries the simulated/demo disclaimer, never implying a real payment", async () => {
    const buffer = await renderFeeReceiptPdf(baseFiling(), baseComplainant());
    const text = await extractText(buffer);

    expect(text).toContain("DEMONSTRATION ONLY");
    expect(text).toContain("No real payment was made");
  });
});

describe("feeReceiptPdfFilename", () => {
  it("mirrors the prototype's own convention: Receipt_{diary number, underscored}.pdf", () => {
    expect(feeReceiptPdfFilename(baseFiling())).toBe("Receipt_TEST_000001_2026.pdf");
  });

  it("falls back to 'unknown' rather than throwing when the diary number is somehow missing", () => {
    expect(feeReceiptPdfFilename(baseFiling({ diaryNumber: null }))).toBe("Receipt_unknown.pdf");
  });
});
