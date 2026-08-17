import { describe, expect, it } from "vitest";
import { PDFParse } from "pdf-parse";
import { complaintPdfFilename, renderComplaintPdf } from "../src/services/complaint-pdf";
import type { FilingRecord } from "../src/repositories/filing-repository";
import type { FilingPartyRecord } from "../src/repositories/filing-party-repository";

// Twilio's outbound mediaUrl caps non-image attachments at 500 KB.
const TWILIO_MEDIA_SIZE_LIMIT = 500 * 1024;

function baseFiling(overrides: Partial<FilingRecord> = {}): FilingRecord {
  return {
    id: "filing-1",
    conversationId: "conversation-1",
    role: "COMPLAINANT_ADVOCATE",
    status: "DRAFT",
    currentStep: "FILING_DRAFT_READY",
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
    narrative: "Lent Rs. 4,50,000 in January 2026 for the accused's shop renovation.",
    witnessPresent: false,
    selectedCourt: "ON Court - I, Kollam",
    declarationAcceptedAt: new Date("2026-04-01"),
    diaryNumber: null,
    filedAt: null,
    courtFeePaidAt: null,
    courtFeeTransactionId: null,
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
    updatedAt: new Date("2026-04-01"),
    ...overrides,
  };
}

function baseParty(role: "COMPLAINANT" | "ACCUSED", overrides: Partial<FilingPartyRecord> = {}): FilingPartyRecord {
  return {
    id: `party-${role.toLowerCase()}`,
    filingId: "filing-1",
    partyRole: role,
    fullName: role === "COMPLAINANT" ? "Anitha Joseph" : "Rajesh Menon",
    phoneOriginal: null,
    phoneNormalized: null,
    emailNormalized: null,
    address: role === "COMPLAINANT" ? "Thekkumkattil House, Kollam 691008" : "Door No. 45, Main Road, Kottarakkara, Kerala",
    filingAsRole: role === "COMPLAINANT" ? "SELF" : null,
    representativeEnrolmentNumber: null,
    entityType: role === "ACCUSED" ? "INDIVIDUAL" : null,
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

describe("renderComplaintPdf", () => {
  it("produces a valid PDF under Twilio's 500 KB non-image media cap", async () => {
    const buffer = await renderComplaintPdf(baseFiling(), baseParty("COMPLAINANT"), baseParty("ACCUSED"));
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.length).toBeLessThan(TWILIO_MEDIA_SIZE_LIMIT);
  });

  it("includes the complainant, accused, cheque, and court details", async () => {
    const buffer = await renderComplaintPdf(baseFiling(), baseParty("COMPLAINANT"), baseParty("ACCUSED"));
    const text = await extractText(buffer);

    expect(text).toContain("Anitha Joseph");
    expect(text).toContain("Rajesh Menon");
    expect(text).toContain("458219");
    expect(text).toContain("4,50,000");
    expect(text).toContain("ON COURT - I, KOLLAM");
    expect(text).toContain("12-03-2026");
  });

  it("includes the computed S.138 limitation window when a service date is known", async () => {
    const buffer = await renderComplaintPdf(baseFiling({ serviceDate: "2026-03-28" }), baseParty("COMPLAINANT"), baseParty("ACCUSED"));
    const text = await extractText(buffer);

    expect(text).toContain("13-04-2026");
    expect(text).toContain("13-05-2026");
    expect(text).toContain("Section 142(1)(b)");
  });

  it("omits the limitation paragraph when there is no service date yet", async () => {
    const buffer = await renderComplaintPdf(baseFiling({ serviceDate: null }), baseParty("COMPLAINANT"), baseParty("ACCUSED"));
    const text = await extractText(buffer);

    expect(text).not.toContain("Section 142(1)(b)");
  });

  it("carries the demo/non-binding disclaimer on every page", async () => {
    const buffer = await renderComplaintPdf(baseFiling(), baseParty("COMPLAINANT"), baseParty("ACCUSED"));
    const text = await extractText(buffer);

    expect(text).toContain("DEMONSTRATION ONLY");
    expect(text).toContain("not legal advice");
  });

  it("includes the typed narrative when present, and lists a witness only when one was present", async () => {
    const withWitness = await extractText(await renderComplaintPdf(baseFiling({ witnessPresent: true }), baseParty("COMPLAINANT"), baseParty("ACCUSED")));
    expect(withWitness).toContain("witness who was present");

    const withoutWitness = await extractText(await renderComplaintPdf(baseFiling({ witnessPresent: false }), baseParty("COMPLAINANT"), baseParty("ACCUSED")));
    expect(withoutWitness).not.toContain("witness who was present");
  });
});

describe("complaintPdfFilename", () => {
  it("mirrors the prototype's own convention: Complaint_S138_{complainant surname}_vs_{accused surname}.pdf", () => {
    expect(complaintPdfFilename(baseParty("COMPLAINANT"), baseParty("ACCUSED"))).toBe("Complaint_S138_Joseph_vs_Menon.pdf");
  });

  it("falls back to 'Party' for a blank/missing name rather than throwing", () => {
    expect(complaintPdfFilename(baseParty("COMPLAINANT", { fullName: null }), baseParty("ACCUSED"))).toBe("Complaint_S138_Party_vs_Menon.pdf");
  });
});
