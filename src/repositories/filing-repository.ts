import type { ConversationLanguage } from "./conversation-repository";
import type { RepositoryTransaction } from "./transaction";

export type FilingRole = "COMPLAINANT_ADVOCATE";
/** #35 — FILED means a diary number has been allotted; the court fee may or may not be paid yet (tracked by courtFeePaidAt, not a further status value). */
export type FilingStatus = "DRAFT" | "SUBMITTED" | "ABANDONED" | "FILED";
export type AdvocateEnrolmentStatus = "PENDING_CONFIRMATION" | "RECORDED_UNVERIFIED";
/** #33 Part C — the cheque's return reason, a fixed 4-option select. */
export type FilingReturnReason = "funds" | "stop" | "acct" | "sign";

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
  /** #33 Part C — cheque and notice particulars. Amount is text (currency), never a float. Dates are plain "YYYY-MM-DD" strings, no time component. */
  chequeNumber: string | null;
  chequeDate: string | null;
  chequeAmount: string | null;
  bankBranch: string | null;
  returnReason: FilingReturnReason | null;
  memoDate: string | null;
  noticeDate: string | null;
  serviceDate: string | null;
  partPayment: boolean | null;
  /** #33 Part D/E — both optional; a typed narrative and/or Part E's uploaded written account (filing_documents, "narrative" group) are alternatives, not both required. */
  narrative: string | null;
  witnessPresent: boolean | null;
  /** #33 Part F — the hardcoded 3-court list; stored as the exact selected label. */
  selectedCourt: string | null;
  /** #33 Part F — when the declaration checkbox was accepted. */
  declarationAcceptedAt: Date | null;
  /** #35 Part B — generated via nextDiaryNumber, set together with status "FILED" and filedAt (see recordFiled). Never hardcoded, never reused across filings. */
  diaryNumber: string | null;
  filedAt: Date | null;
  /** #35 Part B — set together when the simulated fee payment is recorded (see recordFeePaid). courtFeeTransactionId is a fabricated demo value — no real payment gateway is ever called. */
  courtFeePaidAt: Date | null;
  courtFeeTransactionId: string | null;
  /** #37 Part B — the scrutiny-defect correction flow (see schema.ts for the full rationale). */
  defectNotifiedAt: Date | null;
  defectCorrectedChequeNumber: string | null;
  defectDelayReason: string | null;
  defectDelayDays: number | null;
  defectResubmittedAt: Date | null;
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

/**
 * #33 Parts C/D/F — a partial patch of the new field-collecting columns
 * added by this issue. Mirrors FilingPartyRepository.upsertFields: only the
 * keys present are written, everything else on the row is left untouched.
 * One generic method rather than a dedicated setter per field, matching
 * this repo's own stated principle (see setCurrentStep below) — none of
 * these fields pair a step change with a *specific* column the way
 * enrolment's setters do.
 */
export interface UpsertFilingFieldsInput {
  chequeNumber?: string;
  chequeDate?: string;
  chequeAmount?: string;
  bankBranch?: string;
  returnReason?: FilingReturnReason;
  memoDate?: string;
  noticeDate?: string;
  serviceDate?: string;
  partPayment?: boolean;
  narrative?: string;
  witnessPresent?: boolean;
  selectedCourt?: string;
  /** #37 Part B — the scrutiny-defect correction flow. */
  defectNotifiedAt?: Date;
  defectCorrectedChequeNumber?: string;
  defectDelayReason?: string;
  defectDelayDays?: number;
  defectResubmittedAt?: Date;
}

/**
 * #35 Part A (Scope decision: clearly-test format) — a sequential
 * counter, zero-padded to 6 digits, plus the year the filing was actually
 * filed in. Never the prototype's hardcoded KLKL01-000482-2026 shared
 * across every advocate, and unambiguously a demo value, not a real
 * registry diary number. Shared by both the Drizzle and in-memory
 * FilingRepository implementations so tests exercise the exact same
 * format as production.
 */
export function formatDiaryNumber(sequence: number, filedAt: Date): string {
  return `TEST-${String(sequence).padStart(6, "0")}-${filedAt.getFullYear()}`;
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
   * timestamp and advances `current_step` to FILING_DOC_CHEQUE — cascading
   * straight into document collection in the same transaction (#9 Part G;
   * #31's cascade target, replacing #10 Part A's original
   * COMPLAINANT_NAME_PENDING, which is now reached only after all 5
   * document groups are done).
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

  /**
   * Marks a DRAFT filing ABANDONED (restart feature) — a no-op if the
   * filing is no longer DRAFT (e.g. already SUBMITTED), so a stale restart
   * can never downgrade a filing past submission.
   */
  abandonDraft(tx: RepositoryTransaction, filingId: string): Promise<void>;

  /** #33 Parts C/D/F — writes only the given keys of the new field-collecting columns; never touches any column not present in `patch`. */
  upsertFilingFields(tx: RepositoryTransaction, filingId: string, patch: UpsertFilingFieldsInput): Promise<void>;

  /** #33 Part F — records when the declaration checkbox was accepted. Mirrors recordNoticeAcceptance: a single-column timestamp write, the caller sets current_step separately in the same transaction. */
  recordDeclaration(tx: RepositoryTransaction, filingId: string, acceptedAt: Date): Promise<void>;

  /**
   * #35 — resolves the conversation's `active_filing_id` pointer
   * regardless of status, unlike findActiveDraft (which returns null once
   * the filing is no longer DRAFT). Needed once a filing has moved past
   * DRAFT to FILED — conversations.active_filing_id still correctly names
   * it as the filing being acted on (paying the court fee, sending the
   * final completion message), it just isn't an active *draft* anymore.
   */
  findByActiveFilingId(tx: RepositoryTransaction, conversationId: string): Promise<FilingRecord | null>;

  /** #35 Part A — atomically allots the next diary number (via diaryNumberSeq), formatted as "TEST-000001-2026": a zero-padded sequential counter plus filedAt's year. Never the same value twice, never hardcoded. */
  nextDiaryNumber(tx: RepositoryTransaction, filedAt: Date): Promise<string>;

  /** #35 Part A/B — records the filing as filed: status "FILED", the allotted diaryNumber, filedAt, and current_step "FILING_FILED", all together (mirrors confirmEnrolment's pairing of a status change with the columns it depends on). */
  recordFiled(tx: RepositoryTransaction, filingId: string, input: { diaryNumber: string; filedAt: Date }): Promise<void>;

  /**
   * #35 Part A/B — records the simulated court-fee payment and advances
   * current_step straight to "FILING_DONE" in the same write — "paying
   * the fee" is documented as automatic/same-turn (Part A), so
   * FILING_FEE_PAID is never itself persisted as a resting current_step.
   */
  recordFeePaid(tx: RepositoryTransaction, filingId: string, input: { transactionId: string; paidAt: Date }): Promise<void>;

  /**
   * #36 — every filing for this conversation, newest first, regardless of
   * status (DRAFT, ABANDONED, FILED). Broader than findActiveDraft/
   * findByActiveFilingId (both resolve a single filing via the
   * active_filing_id pointer): "My cases" shows every draft and case the
   * advocate has ever started, sectioned by status.
   */
  listByConversation(tx: RepositoryTransaction, conversationId: string): Promise<FilingRecord[]>;
}
