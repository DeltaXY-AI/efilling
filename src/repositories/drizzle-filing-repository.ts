import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { istDayRangeUtc } from "../domain/hearing";
import type { Transaction } from "../db/client";
import { conversations, filings } from "../db/schema";
import {
  FilingNotFoundError,
  formatDiaryNumber,
  formatIaNumber,
  type CreateDraftInput,
  type FilingRecord,
  type FilingRepository,
  type UpsertFilingFieldsInput,
} from "./filing-repository";
import type { RepositoryTransaction } from "./transaction";

/**
 * #38: `filings.hearing_attendance` is a plain `text` column at the DB
 * level (matching the issue's literal Part B schema, not a pg enum), so
 * Drizzle infers it as `string | null` — narrower than FilingRecord's own
 * `HearingAttendance | null`. This narrows every raw row this repository
 * returns; the column's only ever written through `HearingAttendance`-typed
 * application code (see filing-repository.ts's UpsertFilingFieldsInput), so
 * the narrowing is safe, not just asserted.
 */
function toFilingRecord<T extends { hearingAttendance: string | null }>(row: T): T & { hearingAttendance: FilingRecord["hearingAttendance"] } {
  return row as T & { hearingAttendance: FilingRecord["hearingAttendance"] };
}

// Reference-parity fix: a new draft's current_step is fixed straight to
// FILING_DOC_CHEQUE, the first of 5 document-upload groups — no
// ADVOCATE_ENROLMENT_PENDING gate in between anymore (see
// filing-workflow.ts's handleFilingNoticeInput).
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

    return filing ? toFilingRecord(filing) : null;
  }

  async createDraft(tx: RepositoryTransaction, input: CreateDraftInput): Promise<FilingRecord> {
    const t = tx as Transaction;
    const [row] = await t
      .insert(filings)
      .values({
        conversationId: input.conversationId,
        role: input.role,
        status: "DRAFT",
        currentStep: FILING_DOC_CHEQUE_STEP,
        language: input.language,
        testNoticeVersion: input.testNoticeVersion,
      })
      .returning();

    return toFilingRecord(row);
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
    return toFilingRecord(row);
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

  async upsertFilingFields(tx: RepositoryTransaction, filingId: string, patch: UpsertFilingFieldsInput): Promise<void> {
    await (tx as Transaction)
      .update(filings)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(filings.id, filingId));
  }

  async recordDeclaration(tx: RepositoryTransaction, filingId: string, acceptedAt: Date): Promise<void> {
    await (tx as Transaction)
      .update(filings)
      .set({ declarationAcceptedAt: acceptedAt, updatedAt: new Date() })
      .where(eq(filings.id, filingId));
  }

  async findByActiveFilingId(tx: RepositoryTransaction, conversationId: string): Promise<FilingRecord | null> {
    const t = tx as Transaction;

    const [conversationRow] = await t
      .select({ activeFilingId: conversations.activeFilingId })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (!conversationRow?.activeFilingId) {
      return null;
    }

    const [filing] = await t.select().from(filings).where(eq(filings.id, conversationRow.activeFilingId)).limit(1);
    return filing ? toFilingRecord(filing) : null;
  }

  async nextDiaryNumber(tx: RepositoryTransaction, filedAt: Date): Promise<string> {
    const result = await (tx as Transaction).execute(sql`select nextval('diary_number_seq') as val`);
    const sequence = Number((result.rows[0] as { val: string }).val);
    return formatDiaryNumber(sequence, filedAt);
  }

  async recordFiled(tx: RepositoryTransaction, filingId: string, input: { diaryNumber: string; filedAt: Date }): Promise<void> {
    await (tx as Transaction)
      .update(filings)
      .set({ status: "FILED", diaryNumber: input.diaryNumber, filedAt: input.filedAt, currentStep: "FILING_FILED", updatedAt: new Date() })
      .where(eq(filings.id, filingId));
  }

  async recordFeePaid(tx: RepositoryTransaction, filingId: string, input: { transactionId: string; paidAt: Date }): Promise<void> {
    await (tx as Transaction)
      .update(filings)
      .set({
        courtFeePaidAt: input.paidAt,
        courtFeeTransactionId: input.transactionId,
        currentStep: "FILING_DONE",
        updatedAt: new Date(),
      })
      .where(eq(filings.id, filingId));
  }

  async listByConversation(tx: RepositoryTransaction, conversationId: string): Promise<FilingRecord[]> {
    const rows = await (tx as Transaction)
      .select()
      .from(filings)
      .where(eq(filings.conversationId, conversationId))
      .orderBy(desc(filings.createdAt));
    return rows.map(toFilingRecord);
  }

  async findFiledWithHearingOn(tx: RepositoryTransaction, istDate: string): Promise<FilingRecord[]> {
    const { start, end } = istDayRangeUtc(istDate);
    const rows = await (tx as Transaction)
      .select()
      .from(filings)
      .where(and(eq(filings.status, "FILED"), gte(filings.nextHearingDate, start), lt(filings.nextHearingDate, end)));
    return rows.map(toFilingRecord);
  }

  async nextIaNumber(tx: RepositoryTransaction, filedAt: Date): Promise<string> {
    const result = await (tx as Transaction).execute(sql`select nextval('ia_number_seq') as val`);
    const sequence = Number((result.rows[0] as { val: string }).val);
    return formatIaNumber(sequence, filedAt);
  }
}
