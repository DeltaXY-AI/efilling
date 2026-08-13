import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

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
  "ADVOCATE_ENROLMENT_CONFIRM",
  // #10 Part A. COMPLAINANT_DETAILS_START itself is never persisted going
  // forward — confirming enrolment now cascades straight into
  // COMPLAINANT_NAME_PENDING in the same transaction (see
  // enrolment-workflow.ts's confirmEnrolment). The value is kept in the
  // enum only so any pre-existing row already sitting at it (from #9) can
  // still be resumed — see filing-workflow.ts's SUPPORTED_FILING_STEPS.
  "COMPLAINANT_DETAILS_START",
  "COMPLAINANT_NAME_PENDING",
  "COMPLAINANT_PHONE_PENDING",
  "COMPLAINANT_EMAIL_PENDING",
  "COMPLAINANT_ADDRESS_PENDING",
  "COMPLAINANT_CONFIRM",
  "COMPLAINANT_EDIT_FIELD",
  "COMPLAINANT_EDIT_NAME_PENDING",
  "COMPLAINANT_EDIT_PHONE_PENDING",
  "COMPLAINANT_EDIT_EMAIL_PENDING",
  "COMPLAINANT_EDIT_ADDRESS_PENDING",
  "ACCUSED_DETAILS_START",
]);
export const webhookEventStatusEnum = pgEnum("webhook_event_status", ["processing", "processed", "failed"]);
export const filingRoleEnum = pgEnum("filing_role", ["COMPLAINANT_ADVOCATE"]);
export const filingStatusEnum = pgEnum("filing_status", ["DRAFT", "SUBMITTED", "ABANDONED"]);
// Never VERIFIED — no Bar Council integration exists (#9 Part B). Nullable
// on the filings table: no value until a candidate has been typed.
export const advocateEnrolmentStatusEnum = pgEnum("advocate_enrolment_status", ["PENDING_CONFIRMATION", "RECORDED_UNVERIFIED"]);
// #10 Part B. COMPLAINANT today, ACCUSED reserved for V6B — same table, no
// second implementation needed when that slice lands.
export const filingPartyRoleEnum = pgEnum("filing_party_role", ["COMPLAINANT", "ACCUSED"]);
export const filingPartyStatusEnum = pgEnum("filing_party_status", ["DRAFT", "CONFIRMED"]);
export const outboundMessageTypeEnum = pgEnum("outbound_message_type", [
  "FILING_NOTICE",
  "FILING_DRAFT_CHOICE",
  "FILING_DRAFT_CREATED",
  "FILING_RESUMED",
  "MAIN_MENU",
  "ADVOCATE_ENROLMENT_PROMPT",
  "ADVOCATE_ENROLMENT_CONFIRM",
  "ADVOCATE_ENROLMENT_RECORDED",
  "FILING_SAVED",
  "COMPLAINANT_NAME_PROMPT",
  "COMPLAINANT_PHONE_PROMPT",
  "COMPLAINANT_EMAIL_PROMPT",
  "COMPLAINANT_ADDRESS_PROMPT",
  "COMPLAINANT_SUMMARY",
  "COMPLAINANT_REVIEW_ACTIONS",
  "COMPLAINANT_EDIT_FIELDS",
  "COMPLAINANT_RECORDED",
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
    // #9 Part B — the advocate's typed enrolment candidate. No uniqueness
    // constraint: one advocate can have multiple filings. Original and
    // normalized are stored separately (Part C); status is nullable until a
    // candidate has been typed, and is never "VERIFIED" — no Bar Council
    // integration exists in this slice.
    advocateEnrolmentOriginal: text("advocate_enrolment_original"),
    advocateEnrolmentNormalized: text("advocate_enrolment_normalized"),
    advocateEnrolmentStatus: advocateEnrolmentStatusEnum("advocate_enrolment_status"),
    advocateEnrolmentConfirmedAt: timestamp("advocate_enrolment_confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("filings_conversation_status_idx").on(table.conversationId, table.status, table.updatedAt.desc())],
);

/**
 * Normalized per-filing party details (#10 Part B) — one row per
 * `(filing_id, party_role)`, never party fields bolted onto `filings`
 * directly. V6A only ever writes `party_role = COMPLAINANT`; V6B reuses the
 * same table for `ACCUSED` rather than a second implementation. All detail
 * columns are nullable because a row can exist mid-collection (fields fill
 * in one at a time, `status` stays DRAFT) before every required field has
 * been answered. Original and normalized phone are kept separate (#10 Part
 * C), exactly mirroring how the enrolment number is stored on `filings`.
 */
export const filingParties = pgTable(
  "filing_parties",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    filingId: uuid("filing_id")
      .notNull()
      .references(() => filings.id),
    partyRole: filingPartyRoleEnum("party_role").notNull(),
    fullName: text("full_name"),
    phoneOriginal: text("phone_original"),
    phoneNormalized: text("phone_normalized"),
    emailNormalized: text("email_normalized"),
    address: text("address"),
    status: filingPartyStatusEnum("status").notNull().default("DRAFT"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("filing_parties_filing_role_unique").on(table.filingId, table.partyRole),
    index("filing_parties_filing_id_idx").on(table.filingId),
  ],
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
  eventType: text("event_type").notNull(),
  whatsappNumberMaskedOrHash: text("whatsapp_number_masked_or_hash"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  status: webhookEventStatusEnum("status").notNull().default("processing"),
  errorCode: text("error_code"),
});
