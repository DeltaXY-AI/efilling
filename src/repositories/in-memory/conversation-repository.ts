import {
  ConversationNotFoundError,
  type ConversationLanguage,
  type ConversationRecord,
  type ConversationRepository,
  type ConversationState,
} from "../conversation-repository";
import type { RepositoryTransaction } from "../transaction";
import { InMemoryMutex, type InMemoryTransactionHandle } from "./transaction";

let nextId = 1;

/** In-memory ConversationRepository for tests — never used in production. */
export class InMemoryConversationRepository implements ConversationRepository {
  private readonly byWhatsappNumber = new Map<string, ConversationRecord>();
  private readonly mutex = new InMemoryMutex();

  async findByWhatsappNumber(whatsappNumber: string): Promise<ConversationRecord | null> {
    return this.byWhatsappNumber.get(whatsappNumber) ?? null;
  }

  async createAwaitingLanguage(whatsappNumber: string, lastInboundAt: Date): Promise<ConversationRecord> {
    const now = new Date();
    const record: ConversationRecord = {
      id: `test-conversation-${nextId++}`,
      whatsappNumber,
      language: null,
      state: "AWAITING_LANGUAGE",
      activeFilingId: null,
      version: 1,
      lastInboundAt,
      createdAt: now,
      updatedAt: now,
    };
    this.byWhatsappNumber.set(whatsappNumber, record);
    return record;
  }

  async setLanguageAndMainMenu(
    whatsappNumber: string,
    language: ConversationLanguage,
    lastInboundAt: Date,
  ): Promise<ConversationRecord> {
    return this.update(whatsappNumber, { language, state: "MAIN_MENU", lastInboundAt });
  }

  async resetToAwaitingLanguage(whatsappNumber: string, lastInboundAt: Date): Promise<ConversationRecord> {
    return this.update(whatsappNumber, { language: null, state: "AWAITING_LANGUAGE", lastInboundAt });
  }

  async setState(whatsappNumber: string, state: ConversationState, lastInboundAt: Date): Promise<ConversationRecord> {
    return this.update(whatsappNumber, { state, lastInboundAt });
  }

  async touchLastInboundAt(whatsappNumber: string, lastInboundAt: Date): Promise<void> {
    this.update(whatsappNumber, { lastInboundAt });
  }

  async lockById(tx: RepositoryTransaction, conversationId: string): Promise<ConversationRecord> {
    const handle = tx as InMemoryTransactionHandle;
    const release = await this.mutex.acquire(conversationId);
    handle.releases.push(release);

    const record = await this.findById(conversationId);
    if (!record) {
      throw new ConversationNotFoundError(conversationId);
    }
    // Return a fresh read, taken only after the lock was actually granted —
    // a concurrent writer that ran while we were queued must be visible.
    return record;
  }

  async setStateInTx(_tx: RepositoryTransaction, conversationId: string, state: ConversationState): Promise<void> {
    await this.updateById(conversationId, { state });
  }

  async setActiveFilingAndState(
    _tx: RepositoryTransaction,
    conversationId: string,
    activeFilingId: string,
    state: ConversationState,
  ): Promise<void> {
    await this.updateById(conversationId, { activeFilingId, state });
  }

  async resetForRestartInTx(_tx: RepositoryTransaction, conversationId: string): Promise<void> {
    await this.updateById(conversationId, { language: null, state: "AWAITING_LANGUAGE", activeFilingId: null });
  }

  /** #38 — part of the ConversationRepository interface (see conversation-repository.ts). Was previously a synchronous test-only helper; used internally by lockById/updateById below, and now also by the send-hearing-reminders script. */
  async findById(conversationId: string): Promise<ConversationRecord | null> {
    for (const record of this.byWhatsappNumber.values()) {
      if (record.id === conversationId) {
        return record;
      }
    }
    return null;
  }

  private update(whatsappNumber: string, patch: Partial<ConversationRecord>): ConversationRecord {
    const existing = this.byWhatsappNumber.get(whatsappNumber);
    if (!existing) {
      throw new Error(`InMemoryConversationRepository: no conversation for ${whatsappNumber}`);
    }
    const updated: ConversationRecord = { ...existing, ...patch, updatedAt: new Date() };
    this.byWhatsappNumber.set(whatsappNumber, updated);
    return updated;
  }

  private async updateById(conversationId: string, patch: Partial<ConversationRecord>): Promise<ConversationRecord> {
    const existing = await this.findById(conversationId);
    if (!existing) {
      throw new ConversationNotFoundError(conversationId);
    }
    const updated: ConversationRecord = {
      ...existing,
      ...patch,
      version: existing.version + 1,
      updatedAt: new Date(),
    };
    this.byWhatsappNumber.set(existing.whatsappNumber, updated);
    return updated;
  }
}
