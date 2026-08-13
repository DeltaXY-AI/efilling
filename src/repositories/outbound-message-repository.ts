import type { ConversationLanguage } from "./conversation-repository";
import type { RepositoryTransaction } from "./transaction";

export type OutboundMessageType =
  | "FILING_NOTICE"
  | "FILING_DRAFT_CHOICE"
  | "FILING_DRAFT_CREATED"
  | "FILING_RESUMED"
  | "MAIN_MENU"
  | "ADVOCATE_ENROLMENT_PROMPT"
  | "ADVOCATE_ENROLMENT_CONFIRM"
  | "ADVOCATE_ENROLMENT_RECORDED"
  | "FILING_SAVED"
  | "COMPLAINANT_NAME_PROMPT"
  | "COMPLAINANT_PHONE_PROMPT"
  | "COMPLAINANT_EMAIL_PROMPT"
  | "COMPLAINANT_ADDRESS_PROMPT"
  | "COMPLAINANT_SUMMARY"
  | "COMPLAINANT_REVIEW_ACTIONS"
  | "COMPLAINANT_EDIT_FIELDS"
  | "COMPLAINANT_RECORDED"
  | "ACCUSED_NAME_PROMPT"
  | "ACCUSED_PHONE_PROMPT"
  | "ACCUSED_ADDRESS_PROMPT"
  | "ACCUSED_SUMMARY"
  | "ACCUSED_REVIEW_ACTIONS"
  | "ACCUSED_EDIT_FIELDS"
  | "ACCUSED_RECORDED";
export type OutboundMessageStatus = "pending" | "sent" | "failed";

export interface OutboundMessageRecord {
  id: string;
  dedupeKey: string;
  conversationId: string;
  messageType: OutboundMessageType;
  language: ConversationLanguage;
  status: OutboundMessageStatus;
  errorCode: string | null;
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
  markSent(id: string): Promise<void>;
  markFailed(id: string, errorCode: string): Promise<void>;
}
