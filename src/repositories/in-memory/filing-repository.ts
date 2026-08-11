import type { CreateDraftInput, FilingRecord, FilingRepository } from "../filing-repository";
import type { RepositoryTransaction } from "../transaction";
import type { InMemoryConversationRepository } from "./conversation-repository";

let nextId = 1;

/**
 * In-memory FilingRepository for tests — never used in production. Takes
 * the InMemoryConversationRepository it shares a conversation store with,
 * so `findActiveDraft` can resolve the authoritative `active_filing_id`
 * pointer the same way the real DB implementation joins through it.
 */
export class InMemoryFilingRepository implements FilingRepository {
  private readonly byId = new Map<string, FilingRecord>();

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
      currentStep: "ADVOCATE_ENROLMENT_PENDING",
      language: input.language,
      testNoticeVersion: input.testNoticeVersion,
      testNoticeAcceptedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(record.id, record);
    return record;
  }

  async recordNoticeAcceptance(_tx: RepositoryTransaction, filingId: string, acceptedAt: Date): Promise<void> {
    const existing = this.byId.get(filingId);
    if (!existing) {
      throw new Error(`InMemoryFilingRepository: no filing ${filingId}`);
    }
    this.byId.set(filingId, { ...existing, testNoticeAcceptedAt: acceptedAt, updatedAt: new Date() });
  }

  /** Test-wiring helper (not part of the FilingRepository interface) so tests can assert a specific filing's fields directly, e.g. to prove a prior draft was left unchanged. */
  findById(filingId: string): FilingRecord | null {
    return this.byId.get(filingId) ?? null;
  }
}
