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
// #16 spike — which vendor delivered this event. Defaults to "twilio" so the
// existing Twilio webhook route needs no immediate call-site change; "kapso"
// is reserved for the spike adapter (not yet a live sender).
export const webhookProviderEnum = pgEnum("webhook_provider", ["twilio", "kapso"]);
export const filingRoleEnum = pgEnum("filing_role", ["COMPLAINANT_ADVOCATE"]);
export const filingStatusEnum = pgEnum("filing_status", ["DRAFT", "SUBMITTED", "ABANDONED"]);
export const outboundMessageTypeEnum = pgEnum("outbound_message_type", [
  "FILING_NOTICE",
  "FILING_DRAFT_CHOICE",
  "FILING_DRAFT_CREATED",
  "FILING_RESUMED",
  "MAIN_MENU",
]);
export const outboundMessageStatusEnum = pgEnum("outbound_message_status", ["pending", "sent", "failed"]);

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  whatsappNumber: text("whatsapp_number").notNull().unique(),
  language: conversationLanguageEnum("language"),
  state: conversationStateEnum("state").notNull().default("NEW"),
  // Authoritative active-draft pointer — never infer it from the most
  // recently updated filing. Nullable: no active filing until one exists.
  activeFilingId: uuid("active_filing_id").references((): AnyPgColumn => filings.id),
  // #16 spike — schema-only groundwork for Kapso's business-scoped user ID
  // (BSUID), which may arrive without a phone number in a future
  // `whatsapp.contact.identity_changed` event. Nullable and unpopulated by
  // any code path today: whatsapp_number stays the sole, required identity
  // key until an actual BSUID-bearing adapter needs it. A plain `.unique()`
  // on a nullable column is safe in Postgres — multiple NULLs are permitted,
  // so existing phone-keyed rows are unaffected.
  businessScopedUserId: text("business_scoped_user_id").unique(),
  whatsappUsername: text("whatsapp_username"),
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

/**
 * Durable record of outbound intent, written inside the SAME transaction
 * as the domain write it follows (state transition / filing creation) —
 * never after. If the process crashes or a Twilio send fails anywhere
 * after that transaction commits, this row is the recoverable evidence
 * that a specific send was owed for a specific MessageSid; `dedupe_key`
 * (`${messageSid}:${type}`) prevents ever recording the same intent twice.
 * This is what makes a committed state change reconcilable even when the
 * MessageSid claim in `processed_webhook_events` blocks Twilio's own retry
 * from re-entering the workflow.
 */
export const outboundMessages = pgTable("outbound_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id),
  messageType: outboundMessageTypeEnum("message_type").notNull(),
  language: conversationLanguageEnum("language").notNull(),
  status: outboundMessageStatusEnum("status").notNull().default("pending"),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const processedWebhookEvents = pgTable("processed_webhook_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  messageSid: text("message_sid").notNull().unique(),
  // #16 spike — records which vendor's event this is. The uniqueness
  // guarantee still rests on message_sid alone (Twilio SIDs and Kapso
  // wamids are not going to collide in practice); this column is
  // provenance, not (yet) part of the dedupe key.
  provider: webhookProviderEnum("provider").notNull().default("twilio"),
  eventType: text("event_type").notNull(),
  whatsappNumberMaskedOrHash: text("whatsapp_number_masked_or_hash"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  status: webhookEventStatusEnum("status").notNull().default("processing"),
  errorCode: text("error_code"),
});
