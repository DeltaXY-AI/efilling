import type { ConversationLanguage } from "./conversation-repository";
import type { RepositoryTransaction } from "./transaction";

export type FilingRole = "COMPLAINANT_ADVOCATE";
export type FilingStatus = "DRAFT" | "SUBMITTED" | "ABANDONED";

export interface FilingRecord {
  id: string;
  conversationId: string;
  role: FilingRole;
  status: FilingStatus;
  currentStep: string;
  language: ConversationLanguage;
  testNoticeVersion: string | null;
  testNoticeAcceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDraftInput {
  conversationId: string;
  language: ConversationLanguage;
  role: FilingRole;
  testNoticeVersion: string;
}

/**
 * Durable filing-draft storage. Every method accepts the transaction it
 * runs in (see `withTransaction` in src/db/client.ts) so draft creation
 * and the conversation's state/active-filing change commit atomically.
 */
export interface FilingRepository {
  /**
   * Resolves the conversation's active draft via `conversations.active_filing_id`
   * — the authoritative pointer — never by picking the most recently
   * updated filing for the conversation. Returns null if there is no
   * active filing, or if it's no longer in DRAFT status.
   */
  findActiveDraft(tx: RepositoryTransaction, conversationId: string): Promise<FilingRecord | null>;

  /** Creates a new DRAFT filing with current_step fixed to ADVOCATE_ENROLMENT_PENDING (#8 Part H). Does not touch the conversation. */
  createDraft(tx: RepositoryTransaction, input: CreateDraftInput): Promise<FilingRecord>;

  recordNoticeAcceptance(tx: RepositoryTransaction, filingId: string, acceptedAt: Date): Promise<void>;
}
