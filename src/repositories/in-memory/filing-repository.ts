import {
  FilingNotFoundError,
  formatDiaryNumber,
  type CreateDraftInput,
  type FilingRecord,
  type FilingRepository,
  type SaveEnrolmentCandidateInput,
  type UpsertFilingFieldsInput,
} from "../filing-repository";
import type { RepositoryTransaction } from "../transaction";
import type { InMemoryConversationRepository } from "./conversation-repository";
import { InMemoryMutex, type InMemoryTransactionHandle } from "./transaction";

let nextId = 1;
// #35 — mirrors the real diary_number_seq Postgres sequence, module-level
// so it's shared across every InMemoryFilingRepository instance a test
// creates, the same way `nextId` above already is.
let nextDiaryNumberSeq = 1;

const ADVOCATE_ENROLMENT_PENDING_STEP = "ADVOCATE_ENROLMENT_PENDING";
const ADVOCATE_ENROLMENT_CONFIRM_STEP = "ADVOCATE_ENROLMENT_CONFIRM";
// #31: confirming enrolment cascades straight into the first document-upload
// group (FILING_DOC_CHEQUE) — see the matching comment in
// drizzle-filing-repository.ts.
const FILING_DOC_CHEQUE_STEP = "FILING_DOC_CHEQUE";

/**
 * In-memory FilingRepository for tests — never used in production. Takes
 * the InMemoryConversationRepository it shares a conversation store with,
 * so `findActiveDraft` can resolve the authoritative `active_filing_id`
 * pointer the same way the real DB implementation joins through it.
 */
export class InMemoryFilingRepository implements FilingRepository {
  private readonly byId = new Map<string, FilingRecord>();
  // Keyed by filing id, mirroring InMemoryConversationRepository's mutex —
  // so concurrent Confirm/Edit calls on the same filing genuinely queue
  // instead of both reading stale state (#9 Part K).
  private readonly mutex = new InMemoryMutex();

  constructor(private readonly conversationRepo: InMemoryConversationRepository) {}

  async findActiveDraft(_tx: RepositoryTransaction, conversationId: string): Promise<FilingRecord | null> {
    const conversation = this.conversationRepo.findById(conversationId);
    if (!conversation?.activeFilingId) {
      return null;
    }
    const filing = this.byId.get(conversation.activeFilingId);
    if (!filing || filing.status !== "DRAFT") {
      return null;
    }
    return filing;
  }

  async createDraft(_tx: RepositoryTransaction, input: CreateDraftInput): Promise<FilingRecord> {
    const now = new Date();
    const record: FilingRecord = {
      id: `test-filing-${nextId++}`,
      conversationId: input.conversationId,
      role: input.role,
      status: "DRAFT",
      currentStep: ADVOCATE_ENROLMENT_PENDING_STEP,
      language: input.language,
      testNoticeVersion: input.testNoticeVersion,
      testNoticeAcceptedAt: null,
      advocateEnrolmentOriginal: null,
      advocateEnrolmentNormalized: null,
      advocateEnrolmentStatus: null,
      advocateEnrolmentConfirmedAt: null,
      chequeNumber: null,
      chequeDate: null,
      chequeAmount: null,
      bankBranch: null,
      returnReason: null,
      memoDate: null,
      noticeDate: null,
      serviceDate: null,
      partPayment: null,
      narrative: null,
      witnessPresent: null,
      selectedCourt: null,
      declarationAcceptedAt: null,
      diaryNumber: null,
      filedAt: null,
      courtFeePaidAt: null,
      courtFeeTransactionId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(record.id, record);
    return record;
  }

  async recordNoticeAcceptance(_tx: RepositoryTransaction, filingId: string, acceptedAt: Date): Promise<void> {
    this.update(filingId, { testNoticeAcceptedAt: acceptedAt });
  }

  async lockById(tx: RepositoryTransaction, filingId: string): Promise<FilingRecord> {
    const handle = tx as InMemoryTransactionHandle;
    const release = await this.mutex.acquire(filingId);
    handle.releases.push(release);

    const record = this.byId.get(filingId);
    if (!record) {
      throw new FilingNotFoundError(filingId);
    }
    // Return a fresh read, taken only after the lock was actually granted —
    // a concurrent writer that ran while we were queued must be visible.
    return record;
  }

  async saveEnrolmentCandidate(_tx: RepositoryTransaction, filingId: string, input: SaveEnrolmentCandidateInput): Promise<void> {
    this.update(filingId, {
      advocateEnrolmentOriginal: input.original,
      advocateEnrolmentNormalized: input.normalized,
      advocateEnrolmentStatus: "PENDING_CONFIRMATION",
      currentStep: ADVOCATE_ENROLMENT_CONFIRM_STEP,
    });
  }

  async confirmEnrolment(_tx: RepositoryTransaction, filingId: string, confirmedAt: Date): Promise<void> {
    this.update(filingId, {
      advocateEnrolmentStatus: "RECORDED_UNVERIFIED",
      advocateEnrolmentConfirmedAt: confirmedAt,
      currentStep: FILING_DOC_CHEQUE_STEP,
    });
  }

  async clearEnrolmentCandidate(_tx: RepositoryTransaction, filingId: string): Promise<void> {
    this.update(filingId, {
      advocateEnrolmentOriginal: null,
      advocateEnrolmentNormalized: null,
      advocateEnrolmentStatus: null,
      advocateEnrolmentConfirmedAt: null,
      currentStep: ADVOCATE_ENROLMENT_PENDING_STEP,
    });
  }

  async setCurrentStep(_tx: RepositoryTransaction, filingId: string, step: string): Promise<void> {
    this.update(filingId, { currentStep: step });
  }

  async abandonDraft(_tx: RepositoryTransaction, filingId: string): Promise<void> {
    const existing = this.byId.get(filingId);
    if (!existing || existing.status !== "DRAFT") {
      return;
    }
    this.update(filingId, { status: "ABANDONED" });
  }

  async upsertFilingFields(_tx: RepositoryTransaction, filingId: string, patch: UpsertFilingFieldsInput): Promise<void> {
    this.update(filingId, patch);
  }

  async recordDeclaration(_tx: RepositoryTransaction, filingId: string, acceptedAt: Date): Promise<void> {
    this.update(filingId, { declarationAcceptedAt: acceptedAt });
  }

  async findByActiveFilingId(_tx: RepositoryTransaction, conversationId: string): Promise<FilingRecord | null> {
    const conversation = this.conversationRepo.findById(conversationId);
    if (!conversation?.activeFilingId) {
      return null;
    }
    return this.byId.get(conversation.activeFilingId) ?? null;
  }

  async nextDiaryNumber(_tx: RepositoryTransaction, filedAt: Date): Promise<string> {
    return formatDiaryNumber(nextDiaryNumberSeq++, filedAt);
  }

  async recordFiled(_tx: RepositoryTransaction, filingId: string, input: { diaryNumber: string; filedAt: Date }): Promise<void> {
    this.update(filingId, { status: "FILED", diaryNumber: input.diaryNumber, filedAt: input.filedAt, currentStep: "FILING_FILED" });
  }

  async recordFeePaid(_tx: RepositoryTransaction, filingId: string, input: { transactionId: string; paidAt: Date }): Promise<void> {
    this.update(filingId, { courtFeePaidAt: input.paidAt, courtFeeTransactionId: input.transactionId, currentStep: "FILING_DONE" });
  }

  /** Test-wiring helper (not part of the FilingRepository interface) so tests can assert a specific filing's fields directly, e.g. to prove a prior draft was left unchanged. */
  findById(filingId: string): FilingRecord | null {
    return this.byId.get(filingId) ?? null;
  }

  private update(filingId: string, patch: Partial<FilingRecord>): void {
    const existing = this.byId.get(filingId);
    if (!existing) {
      throw new FilingNotFoundError(filingId);
    }
    this.byId.set(filingId, { ...existing, ...patch, updatedAt: new Date() });
  }
}
