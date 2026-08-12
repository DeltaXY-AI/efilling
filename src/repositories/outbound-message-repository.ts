import type { ConversationLanguage } from "./conversation-repository";
import type { RepositoryTransaction } from "./transaction";

export type OutboundMessageType = "FILING_NOTICE" | "FILING_DRAFT_CHOICE" | "FILING_DRAFT_CREATED" | "FILING_RESUMED" | "MAIN_MENU";
export type OutboundMessageStatus = "pending" | "sent" | "failed";
/** Meta's WhatsApp delivery lifecycle, reported asynchronously via provider status webhooks (#16 task 7) — see schema.ts's outboundDeliveryStatusEnum. */
export type OutboundDeliveryStatus = "sent" | "delivered" | "read" | "failed";

export interface OutboundMessageRecord {
  id: string;
  dedupeKey: string;
  conversationId: string;
  messageType: OutboundMessageType;
  language: ConversationLanguage;
  status: OutboundMessageStatus;
  errorCode: string | null;
  providerMessageId: string | null;
  deliveryStatus: OutboundDeliveryStatus | null;
  deliveryStatusUpdatedAt: Date | null;
  deliveryErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnqueueOutboundMessageInput {
  dedupeKey: string;
  conversationId: string;
  messageType: OutboundMessageType;
  language: ConversationLanguage;
}

/**
 * Durable outbound intent, enqueued inside the same transaction as the
 * domain write it follows. `dedupeKey` (`${messageSid}:${type}`) makes
 * recording it idempotent — enqueuing the same intent twice is a no-op,
 * returning null rather than a second row. Dispatch and status update
 * happen after the transaction commits (see filing-workflow.ts).
 */
export interface OutboundMessageRepository {
  /** Returns null if `dedupeKey` already exists rather than creating a duplicate. */
  enqueue(tx: RepositoryTransaction, input: EnqueueOutboundMessageInput): Promise<OutboundMessageRecord | null>;
  /** `providerMessageId` is the join key a later delivery-status webhook reconciles against (#16 task 7) — omitted when the provider's send didn't return one. */
  markSent(id: string, providerMessageId?: string): Promise<void>;
  markFailed(id: string, errorCode: string): Promise<void>;
  /**
   * Applies a delivery-status webhook (sent/delivered/read/failed) to the
   * row whose providerMessageId matches, but only if `occurredAt` is not
   * older than what's already recorded — guards against an out-of-order
   * retry regressing a later status. Returns `matched: false` (not an
   * error) when no row has this providerMessageId at all — e.g. a status
   * event for a message this deployment never sent, or one that arrived
   * before its own markSent committed; callers should log this safely
   * rather than treat it as a failure.
   */
  recordDeliveryStatus(
    providerMessageId: string,
    status: OutboundDeliveryStatus,
    occurredAt: Date,
    errorCode?: string,
  ): Promise<{ matched: boolean }>;
}
