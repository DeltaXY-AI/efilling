import type { EnqueueOutboundMessageInput, OutboundMessageRecord, OutboundMessageRepository } from "../outbound-message-repository";
import type { RepositoryTransaction } from "../transaction";

let nextId = 1;

/** In-memory OutboundMessageRepository for tests — never used in production. */
export class InMemoryOutboundMessageRepository implements OutboundMessageRepository {
  private readonly byId = new Map<string, OutboundMessageRecord>();
  private readonly byDedupeKey = new Map<string, string>();

  async enqueue(_tx: RepositoryTransaction, input: EnqueueOutboundMessageInput): Promise<OutboundMessageRecord | null> {
    if (this.byDedupeKey.has(input.dedupeKey)) {
      return null;
    }

    const now = new Date();
    const record: OutboundMessageRecord = {
      id: `test-outbound-${nextId++}`,
      dedupeKey: input.dedupeKey,
      conversationId: input.conversationId,
      messageType: input.messageType,
      language: input.language,
      status: "pending",
      errorCode: null,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(record.id, record);
    this.byDedupeKey.set(input.dedupeKey, record.id);
    return record;
  }

  async markSent(id: string): Promise<void> {
    this.update(id, { status: "sent", errorCode: null });
  }

  async markFailed(id: string, errorCode: string): Promise<void> {
    this.update(id, { status: "failed", errorCode });
  }

  /** Test-wiring helper (not part of the OutboundMessageRepository interface) so tests can assert a record's fields directly. */
  findById(id: string): OutboundMessageRecord | null {
    return this.byId.get(id) ?? null;
  }

  /** Test-wiring helper — looks a record up the same way ops/reconciliation tooling would: by its dedupe key. */
  findByDedupeKey(dedupeKey: string): OutboundMessageRecord | null {
    const id = this.byDedupeKey.get(dedupeKey);
    return id ? this.byId.get(id) ?? null : null;
  }

  private update(id: string, patch: Partial<OutboundMessageRecord>): void {
    const existing = this.byId.get(id);
    if (!existing) {
      throw new Error(`InMemoryOutboundMessageRepository: no record ${id}`);
    }
    this.byId.set(id, { ...existing, ...patch, updatedAt: new Date() });
  }
}
