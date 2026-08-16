import type { FilingDocumentGroup } from "../domain/filing-document";
import type { RepositoryTransaction } from "./transaction";

export type { FilingDocumentGroup };

export interface FilingDocumentRecord {
  id: string;
  filingId: string;
  documentGroup: FilingDocumentGroup;
  storageUrl: string;
  contentType: string;
  originalTwilioMediaUrl: string | null;
  createdAt: Date;
}

export interface AddFilingDocumentInput {
  filingId: string;
  documentGroup: FilingDocumentGroup;
  /** Durable copy (Vercel Blob) — never Twilio's own `MediaUrl` (#31 Part D). */
  storageUrl: string;
  contentType: string;
  /** Audit-only; expected to expire, never relied on for retrieval (#31 Part B). */
  originalTwilioMediaUrl: string;
}

/**
 * Durable storage for uploaded filing documents (#31, Prototype parity —
 * Phase 3) — one row per file, unlike `filing_parties`' one-row-per-role
 * upsert, since a group can hold multiple files (up to its own max count).
 * Every method accepts the transaction it runs in so a document write, the
 * filing's `current_step`, and the conversation's state always commit
 * atomically together (mirrors FilingPartyRepository).
 */
export interface FilingDocumentRepository {
  /** Appends one document row — never updates or replaces an existing one. */
  addDocument(tx: RepositoryTransaction, input: AddFilingDocumentInput): Promise<FilingDocumentRecord>;

  /** Current file count for this filing+group — what min/max validation is checked against (#31 Part A). */
  countByGroup(tx: RepositoryTransaction, filingId: string, documentGroup: FilingDocumentGroup): Promise<number>;

  /** Every document on this filing, across all groups — used for #31's Developer verification and, later, draft-discard cleanup (#36). */
  listByFiling(tx: RepositoryTransaction, filingId: string): Promise<FilingDocumentRecord[]>;

  /**
   * #36 — deletes every filing_documents row for this filing. Only the DB
   * rows: the caller (filing-draft-list-workflow.ts) is responsible for
   * deleting the underlying Blob files first, via BlobStorage.delete, since
   * that's a separate, non-transactional I/O step.
   */
  deleteByFiling(tx: RepositoryTransaction, filingId: string): Promise<void>;
}
