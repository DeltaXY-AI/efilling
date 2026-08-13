import type { ConversationLanguage } from "./conversation-repository";
import type { RepositoryTransaction } from "./transaction";

export type FilingRole = "COMPLAINANT_ADVOCATE";
export type FilingStatus = "DRAFT" | "SUBMITTED" | "ABANDONED";
export type AdvocateEnrolmentStatus = "PENDING_CONFIRMATION" | "RECORDED_UNVERIFIED";

export interface FilingRecord {
  id: string;
  conversationId: string;
  role: FilingRole;
  status: FilingStatus;
  currentStep: string;
  language: ConversationLanguage;
  testNoticeVersion: string | null;
  testNoticeAcceptedAt: Date | null;
  /** #9 Part B — the advocate's typed enrolment candidate. Never conflated: the trimmed original and the normalized value are separate fields. */
  advocateEnrolmentOriginal: string | null;
  advocateEnrolmentNormalized: string | null;
  /** Never "VERIFIED" — no Bar Council integration exists in this slice. */
  advocateEnrolmentStatus: AdvocateEnrolmentStatus | null;
  advocateEnrolmentConfirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDraftInput {
  conversationId: string;
  language: ConversationLanguage;
  role: FilingRole;
  testNoticeVersion: string;
}

export interface SaveEnrolmentCandidateInput {
  original: string;
  normalized: string;
}

/** Thrown by `lockById` when the filing row no longer exists. */
export class FilingNotFoundError extends Error {
  constructor(public readonly filingId: string) {
    super(`Filing not found: ${filingId}`);
    this.name = "FilingNotFoundError";
  }
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

  /**
   * Locks the filing row for the remainder of `tx` (`SELECT ... FOR
   * UPDATE`) — #9 Part K uses this to serialize a concurrent Confirm/Edit
   * on the same filing so only the first valid transition applies. Throws
   * `FilingNotFoundError` if the row no longer exists.
   */
  lockById(tx: RepositoryTransaction, filingId: string): Promise<FilingRecord>;

  /**
   * Records a new enrolment candidate as PENDING_CONFIRMATION and advances
   * `current_step` to ADVOCATE_ENROLMENT_CONFIRM (#9 Part F).
   */
  saveEnrolmentCandidate(tx: RepositoryTransaction, filingId: string, input: SaveEnrolmentCandidateInput): Promise<void>;

  /**
   * Marks the pending candidate RECORDED_UNVERIFIED with a confirmation
   * timestamp and advances `current_step` to COMPLAINANT_NAME_PENDING —
   * cascading straight into complainant detail collection in the same
   * transaction (#9 Part G; #10 Part A's "state entry" transition out of
   * COMPLAINANT_DETAILS_START, which is never actually persisted).
   */
  confirmEnrolment(tx: RepositoryTransaction, filingId: string, confirmedAt: Date): Promise<void>;

  /**
   * Clears the enrolment candidate and resets `current_step` back to
   * ADVOCATE_ENROLMENT_PENDING (#9 Part H, Edit) so a fresh number can be
   * entered without corrupting the rest of the filing.
   */
  clearEnrolmentCandidate(tx: RepositoryTransaction, filingId: string): Promise<void>;

  /**
   * Generic `current_step` setter (#10 Part B: "The conversation state and
   * filing step must move together in the same transaction"). Used by the
   * complainant-details flow's own field/edit/confirm transitions, which
   * have no other filing column to change alongside the step — unlike the
   * enrolment-specific setters above, which pair a step change with an
   * enrolment column write.
   */
  setCurrentStep(tx: RepositoryTransaction, filingId: string, step: string): Promise<void>;
}
