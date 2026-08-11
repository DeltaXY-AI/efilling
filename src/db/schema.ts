import { index, integer, pgEnum, pgTable, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * Conversation + filing + processed-webhook persistence for the
 * Complainant Advocate flow. Vercel function instances are ephemeral, so
 * this state must live in a real database, never an in-memory map.
 */

export const conversationLanguageEnum = pgEnum("conversation_language", ["en", "ml"]);
export const conversationStateEnum = pgEnum("conversation_state", [
  "NEW",
  "AWAITING_LANGUAGE",
  "MAIN_MENU",
  "FILING_START",
  "CASE_STATUS_START",
  "FILING_DRAFT_CHOICE",
  "FILING_NOTICE",
  "ADVOCATE_ENROLMENT_PENDING",
]);
export const webhookEventStatusEnum = pgEnum("webhook_event_status", ["processing", "processed", "failed"]);
export const filingRoleEnum = pgEnum("filing_role", ["COMPLAINANT_ADVOCATE"]);
export const filingStatusEnum = pgEnum("filing_status", ["DRAFT", "SUBMITTED", "ABANDONED"]);

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  whatsappNumber: text("whatsapp_number").notNull().unique(),
  language: conversationLanguageEnum("language"),
  state: conversationStateEnum("state").notNull().default("NEW"),
  // Authoritative active-draft pointer — never infer it from the most
  // recently updated filing. Nullable: no active filing until one exists.
  activeFilingId: uuid("active_filing_id").references((): AnyPgColumn => filings.id),
  // Incremented on every conversation update. The actual concurrency
  // guarantee for filing transitions comes from row-locking the
  // conversation inside a transaction (see ConversationRepository.lockById)
  // — this is kept as an auditable secondary signal, per Part B.
  version: integer("version").notNull().default(1),
  lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const filings = pgTable(
  "filings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    role: filingRoleEnum("role").notNull().default("COMPLAINANT_ADVOCATE"),
    status: filingStatusEnum("status").notNull().default("DRAFT"),
    currentStep: text("current_step").notNull(),
    language: conversationLanguageEnum("language").notNull(),
    testNoticeVersion: text("test_notice_version"),
    testNoticeAcceptedAt: timestamp("test_notice_accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("filings_conversation_status_idx").on(table.conversationId, table.status, table.updatedAt.desc())],
);

export const processedWebhookEvents = pgTable("processed_webhook_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  messageSid: text("message_sid").notNull().unique(),
  eventType: text("event_type").notNull(),
  whatsappNumberMaskedOrHash: text("whatsapp_number_masked_or_hash"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  status: webhookEventStatusEnum("status").notNull().default("processing"),
  errorCode: text("error_code"),
});
