import { and, eq } from "drizzle-orm";
import type { Transaction } from "../db/client";
import { conversations, filings } from "../db/schema";
import type { CreateDraftInput, FilingRecord, FilingRepository } from "./filing-repository";
import type { RepositoryTransaction } from "./transaction";

const ADVOCATE_ENROLMENT_PENDING_STEP = "ADVOCATE_ENROLMENT_PENDING";

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
}
