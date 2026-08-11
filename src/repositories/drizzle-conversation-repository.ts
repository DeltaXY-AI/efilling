import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { conversations } from "../db/schema";
import type {
  ConversationLanguage,
  ConversationRecord,
  ConversationRepository,
  ConversationState,
} from "./conversation-repository";

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
}
