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
  | "FILING_DOC_CHEQUE_PROMPT"
  | "FILING_DOC_MEMO_PROMPT"
  | "FILING_DOC_NOTICE_PROMPT"
  | "FILING_DOC_ID_PROMPT"
  | "FILING_DOC_SUPPORT_PROMPT"
  | "FILING_DOC_ALL_RECEIVED"
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
  | "ACCUSED_RECORDED"
  // #33 Part A.
  | "COMPLAINANT_ROLE_PROMPT"
  | "COMPLAINANT_ENROL_PROMPT"
  // #33 Part B.
  | "ACCUSED_ENTITY_TYPE_PROMPT"
  // #33 Part C.
  | "FILING_CHEQUE_NUMBER_PROMPT"
  | "FILING_CHEQUE_DATE_PROMPT"
  | "FILING_AMOUNT_PROMPT"
  | "FILING_BANK_BRANCH_PROMPT"
  | "FILING_RETURN_REASON_PROMPT"
  | "FILING_MEMO_DATE_PROMPT"
  | "FILING_NOTICE_DATE_PROMPT"
  | "FILING_SERVICE_DATE_PROMPT"
  | "FILING_PART_PAYMENT_PROMPT"
  // #33 Part D.
  | "FILING_STORY_PROMPT"
  | "FILING_WITNESS_PROMPT"
  // #33 Part E.
  | "FILING_WRITTEN_ACCOUNT_PROMPT"
  // #33 Part F.
  | "FILING_COURT_PROMPT"
  | "FILING_REVIEW_SUMMARY"
  | "FILING_REVIEW_ACTIONS"
  | "FILING_EDIT_GROUP_PROMPT"
  | "FILING_EDIT_CHEQUE_FIELD_PROMPT"
  | "FILING_EDIT_NARRATIVE_FIELD_PROMPT"
  | "FILING_DECLARE_PROMPT"
  | "FILING_RECORDED"
  | "FILING_DRAFT_READY_SUMMARY"
  | "FILING_DRAFT_READY_ACTIONS"
  | "FILING_OTP_PROMPT"
  | "FILING_FILED_SUMMARY"
  | "FILING_FILED_ACTIONS"
  | "FILING_FEE_PAID_MESSAGE"
  | "FILING_DONE_MESSAGE"
  | "FILING_DRAFT_LIST_MESSAGE"
  | "FILING_DRAFT_DETAIL_MESSAGE"
  | "FILING_DRAFT_DISCARDED_MESSAGE";
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
