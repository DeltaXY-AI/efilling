import type {
  ConversationLanguage,
  ConversationRecord,
  ConversationRepository,
  ConversationState,
} from "../conversation-repository";

let nextId = 1;

/** In-memory ConversationRepository for tests — never used in production. */
export class InMemoryConversationRepository implements ConversationRepository {
  private readonly byWhatsappNumber = new Map<string, ConversationRecord>();

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

  private update(whatsappNumber: string, patch: Partial<ConversationRecord>): ConversationRecord {
    const existing = this.byWhatsappNumber.get(whatsappNumber);
    if (!existing) {
      throw new Error(`InMemoryConversationRepository: no conversation for ${whatsappNumber}`);
    }
    const updated: ConversationRecord = { ...existing, ...patch, updatedAt: new Date() };
    this.byWhatsappNumber.set(whatsappNumber, updated);
    return updated;
  }
}
