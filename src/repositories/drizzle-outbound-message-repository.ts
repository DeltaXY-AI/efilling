import { and, eq, isNull, lt, or } from "drizzle-orm";
import { getDb, type Transaction } from "../db/client";
import { outboundMessages } from "../db/schema";
import type {
  EnqueueOutboundMessageInput,
  OutboundDeliveryStatus,
  OutboundMessageRecord,
  OutboundMessageRepository,
} from "./outbound-message-repository";
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

  async markSent(id: string, providerMessageId?: string): Promise<void> {
    const db = getDb();
    await db
      .update(outboundMessages)
      .set({ status: "sent", providerMessageId: providerMessageId ?? null, updatedAt: new Date() })
      .where(eq(outboundMessages.id, id));
  }

  async markFailed(id: string, errorCode: string): Promise<void> {
    const db = getDb();
    await db.update(outboundMessages).set({ status: "failed", errorCode, updatedAt: new Date() }).where(eq(outboundMessages.id, id));
  }

  async recordDeliveryStatus(
    providerMessageId: string,
    status: OutboundDeliveryStatus,
    occurredAt: Date,
    errorCode?: string,
  ): Promise<{ matched: boolean }> {
    const db = getDb();
    const updated = await db
      .update(outboundMessages)
      .set({ deliveryStatus: status, deliveryStatusUpdatedAt: occurredAt, deliveryErrorCode: errorCode ?? null, updatedAt: new Date() })
      .where(
        and(
          eq(outboundMessages.providerMessageId, providerMessageId),
          // Never let an out-of-order retry regress a status already newer
          // than this event — see schema.ts's comment on deliveryStatusUpdatedAt.
          or(isNull(outboundMessages.deliveryStatusUpdatedAt), lt(outboundMessages.deliveryStatusUpdatedAt, occurredAt)),
        ),
      )
      .returning({ id: outboundMessages.id });

    if (updated.length > 0) {
      return { matched: true };
    }

    // Distinguish "no such providerMessageId at all" (genuinely unmatched)
    // from "matched, but this event was older than what's already recorded"
    // (matched — just correctly a no-op) so callers don't miscount either case.
    const [existing] = await db
      .select({ id: outboundMessages.id })
      .from(outboundMessages)
      .where(eq(outboundMessages.providerMessageId, providerMessageId))
      .limit(1);

    return { matched: Boolean(existing) };
  }
}
