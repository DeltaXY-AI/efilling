import PDFDocument from "pdfkit";
import { formatIstTimestamp } from "../lib/format-ist-date";
import type { FilingPartyRecord } from "../repositories/filing-party-repository";
import type { FilingRecord } from "../repositories/filing-repository";
import { COURT_FEE_TEXT } from "./filing-completion-sender";

/**
 * Renders the one-page court-fee receipt PDF attached alongside "✅ Court
 * fee paid" (filing-completion-workflow.ts's handleFilingFiledInput).
 * Mirrors the shape of the dristiwa.netlify.app prototype's own
 * RECEIPT_DOC — using this filing's own persisted fields (diaryNumber,
 * courtFeeTransactionId, courtFeePaidAt), never re-derived independently
 * of what renderFeePaidMessage (filing-completion-sender.ts) already
 * renders as chat text.
 *
 * Deliberately a demo-quality template, not a real payment instrument —
 * no real payment gateway is ever called (see
 * generateSimulatedTransactionId in filing-completion-workflow.ts).
 * Always in English, matching complaint-pdf.ts's own choice.
 */

const PAGE_MARGIN = 56;
const DEMO_BANNER = "DEMONSTRATION ONLY — a simulated receipt from a pilot service. No real payment was made.";

/** `Receipt_{diary number with dashes replaced by underscores}.pdf` — mirrors the prototype's own filename convention. */
export function feeReceiptPdfFilename(filing: FilingRecord): string {
  const diary = (filing.diaryNumber ?? "unknown").replace(/-/g, "_");
  return `Receipt_${diary}.pdf`;
}

export function renderFeeReceiptPdf(filing: FilingRecord, complainant: FilingPartyRecord): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: PAGE_MARGIN, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const paidAt = filing.courtFeePaidAt ? formatIstTimestamp(filing.courtFeePaidAt) : "";
    const court = filing.selectedCourt ?? "";

    doc.font("Helvetica-Bold").fontSize(9).text(DEMO_BANNER, { align: "center" });
    doc.moveDown(1.5);
    doc.fontSize(13).text("COURT FEE RECEIPT", { align: "center", underline: true });
    doc.moveDown(1);

    doc.font("Helvetica").fontSize(10);
    doc.text(`Receipt for diary no. ${filing.diaryNumber ?? ""}, dated ${paidAt}.`);
    doc.moveDown(0.5);
    doc.text(
      `Received from ${complainant.fullName ?? ""}${
        complainant.address ? ", " + complainant.address : ""
      }, the sum of ${COURT_FEE_TEXT.en} towards the court fee payable on the complaint filed under Section 138 of the Negotiable Instruments Act, 1881.`,
    );
    doc.moveDown(1);

    doc.font("Helvetica-Bold").text("Particulars");
    doc.font("Helvetica");
    doc.text(`Diary No.        ${filing.diaryNumber ?? ""}`);
    doc.text(`Court            ${court}`);
    doc.text(`Mode of payment  UPI (simulated)`);
    doc.text(`Transaction ID   ${filing.courtFeeTransactionId ?? ""}`);
    doc.text(`Date and time    ${paidAt}`);
    doc.moveDown(1);

    doc.text(`Amount: ${COURT_FEE_TEXT.en}`);
    doc.moveDown(1.5);
    doc.fontSize(8).fillColor("#555555").text(
      "This is a computer-generated demonstration receipt from a pilot service. It does not represent a real transaction and has no legal or financial standing.",
    );

    doc.end();
  });
}
