import type { RepositoryTransaction } from "./transaction";

export type ConversationLanguage = "en" | "ml";
export type ConversationState =
  | "NEW"
  | "AWAITING_LANGUAGE"
  | "MAIN_MENU"
  | "FILING_START"
  | "CASE_STATUS_START"
  | "FILING_DRAFT_CHOICE"
  | "FILING_NOTICE"
  | "ADVOCATE_ENROLMENT_PENDING"
  | "ADVOCATE_ENROLMENT_CONFIRM"
  // #31: sequential document-upload states, one per group.
  | "FILING_DOC_CHEQUE"
  | "FILING_DOC_MEMO"
  | "FILING_DOC_NOTICE"
  | "FILING_DOC_ID"
  | "FILING_DOC_SUPPORT"
  // #10 Part A. Never persisted going forward (see schema.ts) — kept only
  // so a pre-existing row from #9 can still resume.
  | "COMPLAINANT_DETAILS_START"
  | "COMPLAINANT_NAME_PENDING"
  | "COMPLAINANT_PHONE_PENDING"
  | "COMPLAINANT_EMAIL_PENDING"
  | "COMPLAINANT_ADDRESS_PENDING"
  | "COMPLAINANT_CONFIRM"
  | "COMPLAINANT_EDIT_FIELD"
  | "COMPLAINANT_EDIT_NAME_PENDING"
  | "COMPLAINANT_EDIT_PHONE_PENDING"
  | "COMPLAINANT_EDIT_EMAIL_PENDING"
  | "COMPLAINANT_EDIT_ADDRESS_PENDING"
  | "ACCUSED_DETAILS_START";

export interface ConversationRecord {
  id: string;
  whatsappNumber: string;
  language: ConversationLanguage | null;
  state: ConversationState;
  /** Authoritative active-draft pointer (#8) — never inferred from the most recently updated filing. */
  activeFilingId: string | null;
  version: number;
  lastInboundAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Thrown by `lockById` when the conversation row no longer exists. */
export class ConversationNotFoundError extends Error {
  constructor(public readonly conversationId: string) {
    super(`Conversation not found: ${conversationId}`);
    this.name = "ConversationNotFoundError";
  }
}

/**
 * Durable storage for per-advocate conversation state. `whatsappNumber` must
 * already be normalized (see `normalizeWhatsappNumber`) before it is passed
 * to any of these methods.
 */
export interface ConversationRepository {
  findByWhatsappNumber(whatsappNumber: string): Promise<ConversationRecord | null>;

  /** Creates a brand-new conversation in AWAITING_LANGUAGE for a first-ever inbound message. */
  createAwaitingLanguage(whatsappNumber: string, lastInboundAt: Date): Promise<ConversationRecord>;

  /** Persists the selected language and transitions the conversation to MAIN_MENU. */
  setLanguageAndMainMenu(
    whatsappNumber: string,
    language: ConversationLanguage,
    lastInboundAt: Date,
  ): Promise<ConversationRecord>;

  /** Clears any selected language and moves the conversation back to AWAITING_LANGUAGE. */
  resetToAwaitingLanguage(whatsappNumber: string, lastInboundAt: Date): Promise<ConversationRecord>;

  /** Transitions to an arbitrary state without changing the selected language (e.g. MAIN_MENU -> FILING_START). */
  setState(whatsappNumber: string, state: ConversationState, lastInboundAt: Date): Promise<ConversationRecord>;

  /** Updates only the last-inbound timestamp, without changing language/state. */
  touchLastInboundAt(whatsappNumber: string, lastInboundAt: Date): Promise<void>;

  /**
   * Locks the conversation row for the remainder of `tx` (`SELECT ... FOR
   * UPDATE`), so concurrent filing transitions on the same conversation
   * serialize instead of racing. Must be called inside a transaction
   * started via `withTransaction`. Throws `ConversationNotFoundError` if
   * the row no longer exists.
   */
  lockById(tx: RepositoryTransaction, conversationId: string): Promise<ConversationRecord>;

  /** Transitions state within an existing transaction, without touching language or activeFilingId. */
  setStateInTx(tx: RepositoryTransaction, conversationId: string, state: ConversationState): Promise<void>;

  /** Sets the active filing and the next state together, atomically, within an existing transaction. */
  setActiveFilingAndState(
    tx: RepositoryTransaction,
    conversationId: string,
    activeFilingId: string,
    state: ConversationState,
  ): Promise<void>;

  /**
   * Clears language and the active-draft pointer and moves the conversation
   * back to AWAITING_LANGUAGE, atomically with the filing draft's own
   * ABANDONED write (see FilingRepository.abandonDraft) — used by the
   * "restart" keyword so a full restart never leaves active_filing_id
   * pointing at a filing that was just abandoned.
   */
  resetForRestartInTx(tx: RepositoryTransaction, conversationId: string): Promise<void>;
}
