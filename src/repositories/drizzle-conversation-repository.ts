import { eq, sql } from "drizzle-orm";
import { getDb, type Transaction } from "../db/client";
import { conversations } from "../db/schema";
import {
  ConversationNotFoundError,
  type ConversationLanguage,
  type ConversationRecord,
  type ConversationRepository,
  type ConversationState,
} from "./conversation-repository";
import type { RepositoryTransaction } from "./transaction";

export class DrizzleConversationRepository implements ConversationRepository {
  async findByWhatsappNumber(whatsappNumber: string): Promise<ConversationRecord | null> {
    const db = getDb();
    const [row] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.whatsappNumber, whatsappNumber))
      .limit(1);

    return row ?? null;
  }

  async findById(conversationId: string): Promise<ConversationRecord | null> {
    const db = getDb();
    const [row] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);

    return row ?? null;
  }

  async createAwaitingLanguage(whatsappNumber: string, lastInboundAt: Date): Promise<ConversationRecord> {
    const db = getDb();
    const [row] = await db
      .insert(conversations)
      .values({ whatsappNumber, state: "AWAITING_LANGUAGE", lastInboundAt })
      .returning();

    return row;
  }

  async setLanguageAndMainMenu(
    whatsappNumber: string,
    language: ConversationLanguage,
    lastInboundAt: Date,
  ): Promise<ConversationRecord> {
    const db = getDb();
    const [row] = await db
      .update(conversations)
      .set({ language, state: "MAIN_MENU", lastInboundAt, updatedAt: new Date() })
      .where(eq(conversations.whatsappNumber, whatsappNumber))
      .returning();

    return row;
  }

  async resetToAwaitingLanguage(whatsappNumber: string, lastInboundAt: Date): Promise<ConversationRecord> {
    const db = getDb();
    const [row] = await db
      .update(conversations)
      .set({ language: null, state: "AWAITING_LANGUAGE", lastInboundAt, updatedAt: new Date() })
      .where(eq(conversations.whatsappNumber, whatsappNumber))
      .returning();

    return row;
  }

  async setState(whatsappNumber: string, state: ConversationState, lastInboundAt: Date): Promise<ConversationRecord> {
    const db = getDb();
    const [row] = await db
      .update(conversations)
      .set({ state, lastInboundAt, updatedAt: new Date() })
      .where(eq(conversations.whatsappNumber, whatsappNumber))
      .returning();

    return row;
  }

  async touchLastInboundAt(whatsappNumber: string, lastInboundAt: Date): Promise<void> {
    const db = getDb();
    await db
      .update(conversations)
      .set({ lastInboundAt, updatedAt: new Date() })
      .where(eq(conversations.whatsappNumber, whatsappNumber));
  }

  async lockById(tx: RepositoryTransaction, conversationId: string): Promise<ConversationRecord> {
    const [row] = await (tx as Transaction)
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for("update");

    if (!row) {
      throw new ConversationNotFoundError(conversationId);
    }
    return row;
  }

  async setStateInTx(tx: RepositoryTransaction, conversationId: string, state: ConversationState): Promise<void> {
    await (tx as Transaction)
      .update(conversations)
      .set({ state, updatedAt: new Date(), version: sql`${conversations.version} + 1` })
      .where(eq(conversations.id, conversationId));
  }

  async setActiveFilingAndState(
    tx: RepositoryTransaction,
    conversationId: string,
    activeFilingId: string,
    state: ConversationState,
  ): Promise<void> {
    await (tx as Transaction)
      .update(conversations)
      .set({ activeFilingId, state, updatedAt: new Date(), version: sql`${conversations.version} + 1` })
      .where(eq(conversations.id, conversationId));
  }

  async resetForRestartInTx(tx: RepositoryTransaction, conversationId: string): Promise<void> {
    await (tx as Transaction)
      .update(conversations)
      .set({
        language: null,
        state: "AWAITING_LANGUAGE",
        activeFilingId: null,
        updatedAt: new Date(),
        version: sql`${conversations.version} + 1`,
      })
      .where(eq(conversations.id, conversationId));
  }
}
