import { and, eq } from "drizzle-orm";
import type { Transaction } from "../db/client";
import { conversations, filings } from "../db/schema";
import {
  FilingNotFoundError,
  type CreateDraftInput,
  type FilingRecord,
  type FilingRepository,
  type SaveEnrolmentCandidateInput,
} from "./filing-repository";
import type { RepositoryTransaction } from "./transaction";

const ADVOCATE_ENROLMENT_PENDING_STEP = "ADVOCATE_ENROLMENT_PENDING";
const ADVOCATE_ENROLMENT_CONFIRM_STEP = "ADVOCATE_ENROLMENT_CONFIRM";
// #31: confirming enrolment cascades straight into the first document-upload
// group (FILING_DOC_CHEQUE) in the same transaction, rather than resting at
// an intermediate state waiting for another inbound message. This replaces
// #10 Part A's original cascade target (COMPLAINANT_NAME_PENDING), which is
// now reached only after all 5 document groups are done (see
// filing-document-workflow.ts).
const FILING_DOC_CHEQUE_STEP = "FILING_DOC_CHEQUE";

export class DrizzleFilingRepository implements FilingRepository {
  async findActiveDraft(tx: RepositoryTransaction, conversationId: string): Promise<FilingRecord | null> {
    const t = tx as Transaction;

    const [conversationRow] = await t
      .select({ activeFilingId: conversations.activeFilingId })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (!conversationRow?.activeFilingId) {
      return null;
    }

    const [filing] = await t
      .select()
      .from(filings)
      .where(and(eq(filings.id, conversationRow.activeFilingId), eq(filings.status, "DRAFT")))
      .limit(1);

    return filing ?? null;
  }

  async createDraft(tx: RepositoryTransaction, input: CreateDraftInput): Promise<FilingRecord> {
    const t = tx as Transaction;
    const [row] = await t
      .insert(filings)
      .values({
        conversationId: input.conversationId,
        role: input.role,
        status: "DRAFT",
        currentStep: ADVOCATE_ENROLMENT_PENDING_STEP,
        language: input.language,
        testNoticeVersion: input.testNoticeVersion,
      })
      .returning();

    return row;
  }

  async recordNoticeAcceptance(tx: RepositoryTransaction, filingId: string, acceptedAt: Date): Promise<void> {
    await (tx as Transaction)
      .update(filings)
      .set({ testNoticeAcceptedAt: acceptedAt, updatedAt: new Date() })
      .where(eq(filings.id, filingId));
  }

  async lockById(tx: RepositoryTransaction, filingId: string): Promise<FilingRecord> {
    const [row] = await (tx as Transaction).select().from(filings).where(eq(filings.id, filingId)).for("update");

    if (!row) {
      throw new FilingNotFoundError(filingId);
    }
    return row;
  }

  async saveEnrolmentCandidate(tx: RepositoryTransaction, filingId: string, input: SaveEnrolmentCandidateInput): Promise<void> {
    await (tx as Transaction)
      .update(filings)
      .set({
        advocateEnrolmentOriginal: input.original,
        advocateEnrolmentNormalized: input.normalized,
        advocateEnrolmentStatus: "PENDING_CONFIRMATION",
        currentStep: ADVOCATE_ENROLMENT_CONFIRM_STEP,
        updatedAt: new Date(),
      })
      .where(eq(filings.id, filingId));
  }

  async confirmEnrolment(tx: RepositoryTransaction, filingId: string, confirmedAt: Date): Promise<void> {
    await (tx as Transaction)
      .update(filings)
      .set({
        advocateEnrolmentStatus: "RECORDED_UNVERIFIED",
        advocateEnrolmentConfirmedAt: confirmedAt,
        currentStep: FILING_DOC_CHEQUE_STEP,
        updatedAt: new Date(),
      })
      .where(eq(filings.id, filingId));
  }

  async clearEnrolmentCandidate(tx: RepositoryTransaction, filingId: string): Promise<void> {
    await (tx as Transaction)
      .update(filings)
      .set({
        advocateEnrolmentOriginal: null,
        advocateEnrolmentNormalized: null,
        advocateEnrolmentStatus: null,
        advocateEnrolmentConfirmedAt: null,
        currentStep: ADVOCATE_ENROLMENT_PENDING_STEP,
        updatedAt: new Date(),
      })
      .where(eq(filings.id, filingId));
  }

  async setCurrentStep(tx: RepositoryTransaction, filingId: string, step: string): Promise<void> {
    await (tx as Transaction)
      .update(filings)
      .set({ currentStep: step, updatedAt: new Date() })
      .where(eq(filings.id, filingId));
  }

  async abandonDraft(tx: RepositoryTransaction, filingId: string): Promise<void> {
    await (tx as Transaction)
      .update(filings)
      .set({ status: "ABANDONED", updatedAt: new Date() })
      .where(and(eq(filings.id, filingId), eq(filings.status, "DRAFT")));
  }
}
