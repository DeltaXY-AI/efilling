import { eq } from "drizzle-orm";
import { getDb, type Transaction } from "../db/client";
import { outboundMessages } from "../db/schema";
import type { EnqueueOutboundMessageInput, OutboundMessageRecord, OutboundMessageRepository } from "./outbound-message-repository";
import type { RepositoryTransaction } from "./transaction";

export class DrizzleOutboundMessageRepository implements OutboundMessageRepository {
  async enqueue(tx: RepositoryTransaction, input: EnqueueOutboundMessageInput): Promise<OutboundMessageRecord | null> {
    const [row] = await (tx as Transaction)
      .insert(outboundMessages)
      .values({
        dedupeKey: input.dedupeKey,
        conversationId: input.conversationId,
        messageType: input.messageType,
        language: input.language,
      })
      // The unique constraint on dedupe_key is what makes this atomic and
      // idempotent — a duplicate enqueue attempt loses the race and gets
      // zero rows back instead of a duplicate-key error.
      .onConflictDoNothing({ target: outboundMessages.dedupeKey })
      .returning();

    return row ?? null;
  }

  async markSent(id: string): Promise<void> {
    const db = getDb();
    await db.update(outboundMessages).set({ status: "sent", updatedAt: new Date() }).where(eq(outboundMessages.id, id));
  }

  async markFailed(id: string, errorCode: string): Promise<void> {
    const db = getDb();
    await db.update(outboundMessages).set({ status: "failed", errorCode, updatedAt: new Date() }).where(eq(outboundMessages.id, id));
  }
}
