import { FilingNotFoundError, type CreateDraftInput, type FilingRecord, type FilingRepository, type SaveEnrolmentCandidateInput } from "../filing-repository";
import type { RepositoryTransaction } from "../transaction";
import type { InMemoryConversationRepository } from "./conversation-repository";
import { InMemoryMutex, type InMemoryTransactionHandle } from "./transaction";

let nextId = 1;

const ADVOCATE_ENROLMENT_PENDING_STEP = "ADVOCATE_ENROLMENT_PENDING";
const ADVOCATE_ENROLMENT_CONFIRM_STEP = "ADVOCATE_ENROLMENT_CONFIRM";
// #10 Part A: confirming enrolment cascades straight into complainant
// detail collection in the same transaction, rather than resting at the
// (now-unused-going-forward) COMPLAINANT_DETAILS_START value.
const COMPLAINANT_NAME_PENDING_STEP = "COMPLAINANT_NAME_PENDING";

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
      currentStep: COMPLAINANT_NAME_PENDING_STEP,
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
