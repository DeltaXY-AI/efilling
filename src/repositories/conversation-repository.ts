export type ConversationLanguage = "en" | "ml";
export type ConversationState = "NEW" | "AWAITING_LANGUAGE" | "MAIN_MENU";

export interface ConversationRecord {
  id: string;
  whatsappNumber: string;
  language: ConversationLanguage | null;
  state: ConversationState;
  lastInboundAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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

  /** Updates only the last-inbound timestamp, without changing language/state. */
  touchLastInboundAt(whatsappNumber: string, lastInboundAt: Date): Promise<void>;
}
