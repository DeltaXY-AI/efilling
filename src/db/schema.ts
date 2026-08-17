import { boolean, date, index, integer, pgEnum, pgSequence, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

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
  // #31 (Prototype parity - Phase 3): confirming enrolment now cascades
  // into FILING_DOC_CHEQUE, the first of 5 sequential document-upload
  // states, in the same transaction (see enrolment-workflow.ts's
  // confirmEnrolment). One state per document group, each accepting 1+
  // media messages before advancing — see filing-document-workflow.ts.
  "FILING_DOC_CHEQUE",
  "FILING_DOC_MEMO",
  "FILING_DOC_NOTICE",
  "FILING_DOC_ID",
  "FILING_DOC_SUPPORT",
  // #10 Part A. COMPLAINANT_DETAILS_START itself is never persisted going
  // forward — the document-upload states above (#31) now cascade into
  // COMPLAINANT_NAME_PENDING once the last group is done. The value is kept
  // in the enum only so any pre-existing row already sitting at it (from
  // #9) can still be resumed — see filing-workflow.ts's SUPPORTED_FILING_STEPS.
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
  // #11 Part A. ACCUSED_DETAILS_START itself is never persisted going
  // forward, mirroring COMPLAINANT_DETAILS_START above — confirming the
  // complainant now cascades straight into ACCUSED_NAME_PENDING in the
  // same transaction (see complainant-workflow.ts's confirmComplainant).
  // Kept only so a pre-existing row from #10 can still resume.
  "ACCUSED_DETAILS_START",
  "ACCUSED_NAME_PENDING",
  "ACCUSED_PHONE_PENDING",
  "ACCUSED_ADDRESS_PENDING",
  "ACCUSED_CONFIRM",
  "ACCUSED_EDIT_FIELD",
  "ACCUSED_EDIT_NAME_PENDING",
  "ACCUSED_EDIT_PHONE_PENDING",
  "ACCUSED_EDIT_ADDRESS_PENDING",
  // #33 Part B: one new field inserted into #11's existing accused flow,
  // right before ACCUSED_CONFIRM (the review this issue does NOT change).
  "ACCUSED_ENTITY_TYPE_PENDING",
  "ACCUSED_EDIT_ENTITY_TYPE_PENDING",
  // #33 (Prototype parity - Phase 5). CHEQUE_DETAILS_START itself is never
  // persisted going forward, mirroring the *_DETAILS_START sentinels above
  // — confirming the accused now cascades straight into
  // COMPLAINANT_ROLE_PENDING... no wait, into FILING_CHEQUE_NUMBER_PENDING
  // in the same transaction (see accused-workflow.ts's confirmAccused).
  // Kept only so a pre-existing row from #11 can still resume.
  "CHEQUE_DETAILS_START",
  // #33 Part A: two new leading fields on the Complainant screen, inserted
  // before #10's existing COMPLAINANT_NAME_PENDING. `enrol` only applies
  // when `role` = "advocate for client" (see domain/complainant.ts).
  "COMPLAINANT_ROLE_PENDING",
  "COMPLAINANT_ENROL_PENDING",
  "COMPLAINANT_EDIT_ROLE_PENDING",
  "COMPLAINANT_EDIT_ENROL_PENDING",
  // #33 Part C: cheque and notice particulars — 9 fields, one state each,
  // no per-section review of their own (Part F's single combined review
  // covers Parts C-F; Parts A/B keep their own existing #10/#11 review).
  "FILING_CHEQUE_NUMBER_PENDING",
  "FILING_CHEQUE_DATE_PENDING",
  "FILING_AMOUNT_PENDING",
  "FILING_BANK_BRANCH_PENDING",
  "FILING_RETURN_REASON_PENDING",
  "FILING_MEMO_DATE_PENDING",
  "FILING_NOTICE_DATE_PENDING",
  "FILING_SERVICE_DATE_PENDING",
  "FILING_PART_PAYMENT_PENDING",
  // #33 Part D: the transaction narrative — both optional (a typed story,
  // and/or Part E's uploaded written account below; neither is required).
  "FILING_STORY_PENDING",
  "FILING_WITNESS_PENDING",
  // #33 Part E: optional written-account upload (0-2 files), reusing #31's
  // filing_documents table with a new "narrative" document_group value —
  // an alternative to Part D's typed story, not a requirement on top of it.
  "FILING_WRITTEN_ACCOUNT_PENDING",
  // #33 Part F: court selection, then the single combined review across
  // every field collected in Parts C-F (Parts A/B already have their own
  // review/edit loop from #10/#11 and are not re-litigated here), then the
  // declaration checkbox before cascading into Prototype parity - Phase 6.
  "FILING_COURT_PENDING",
  "FILING_REVIEW",
  // Reached after Confirm on FILING_REVIEW — the declaration checkbox is
  // its own screen (mirroring the prototype's separate checkbox UI), not
  // folded into the review's own Confirm action.
  "FILING_DECLARE_PENDING",
  "FILING_EDIT_GROUP_PENDING",
  "FILING_EDIT_CHEQUE_FIELD_PENDING",
  "FILING_EDIT_NARRATIVE_FIELD_PENDING",
  "FILING_EDIT_CHEQUE_NUMBER_PENDING",
  "FILING_EDIT_CHEQUE_DATE_PENDING",
  "FILING_EDIT_AMOUNT_PENDING",
  "FILING_EDIT_BANK_BRANCH_PENDING",
  "FILING_EDIT_RETURN_REASON_PENDING",
  "FILING_EDIT_MEMO_DATE_PENDING",
  "FILING_EDIT_NOTICE_DATE_PENDING",
  "FILING_EDIT_SERVICE_DATE_PENDING",
  "FILING_EDIT_PART_PAYMENT_PENDING",
  "FILING_EDIT_STORY_PENDING",
  "FILING_EDIT_WITNESS_PENDING",
  "FILING_EDIT_COURT_PENDING",
  // #34 (Prototype parity - Phase 6): DRAFT_READY_START itself is never
  // persisted going forward — declaring now cascades straight into
  // FILING_DRAFT_READY in the same transaction (see filing-review-
  // workflow.ts's handleFilingDeclareInput). Kept only so a pre-existing
  // row from #33 can still resume (see filing-workflow.ts's resumeDraft).
  "DRAFT_READY_START",
  "FILING_DRAFT_READY",
  "FILING_OTP_PENDING",
  // #35 (Prototype parity - Phase 7): FILING_FILED_START itself is never
  // persisted going forward — a valid OTP now cascades straight into the
  // real FILING_FILED (diary number generated, filed-summary + pay-fee
  // actions sent) in the same transaction (see filing-sign-workflow.ts's
  // handleFilingOtpInput). Kept only so a pre-existing row from #34 can
  // still resume (see filing-workflow.ts's resumeDraft).
  "FILING_FILED_START",
  "FILING_FILED",
  // FILING_FEE_PAID (part of #35's own FilingCompletionState type) is
  // intentionally never persisted — paying the fee cascades straight to
  // FILING_DONE in the same transaction (see filing-completion-
  // workflow.ts's handleFilingFiledInput), the same "no dead intermediate
  // state" cascade used everywhere else in this codebase. Not added here
  // since a value that can never appear on a row would only invite
  // confusion.
  "FILING_DONE",
  // #36 (Prototype parity - Phase 8): "My cases" — a sectioned list of
  // every filing for this conversation (Drafts / Active cases), and the
  // per-draft detail card (Resume / Discard). No database changes beyond
  // these two conversation states — see filing-repository.ts's
  // listByConversation and filing-draft-list-workflow.ts.
  "FILING_DRAFT_LIST",
  "FILING_DRAFT_DETAIL",
  // #37 (Prototype parity - Phase 9): the scrutiny-defect correction flow —
  // reachable only from a FILED filing (see filing-draft-list-workflow.ts's
  // "Simulate scrutiny defects" action on the case-status screen, #36).
  // Sequential, one defect per state (mirrors #33's own field-by-field
  // convention); Defect 3's two sub-questions (delay reason, then days of
  // delay) share this one FILING_DEFECT_3 state, distinguished by whether
  // defect_delay_reason is already set — see filing-defect-workflow.ts.
  "FILING_DEFECT_ALERT",
  "FILING_DEFECT_1",
  "FILING_DEFECT_2",
  "FILING_DEFECT_3",
  "FILING_DEFECT_REVIEW",
  "FILING_DEFECT_SENT",
]);
export const webhookEventStatusEnum = pgEnum("webhook_event_status", ["processing", "processed", "failed"]);
export const filingRoleEnum = pgEnum("filing_role", ["COMPLAINANT_ADVOCATE"]);
// #35: FILED means the diary number has been allotted (recordFiled) — the
// court fee may or may not be paid yet; that progress is tracked by
// courtFeePaidAt below, not a further status value (Part A only asks for
// one new status). Once a filing is FILED, findActiveDraft (which only
// ever returns DRAFT filings) naturally stops treating it as an active
// draft to resume — the same mechanism abandonDraft already relies on.
export const filingStatusEnum = pgEnum("filing_status", ["DRAFT", "SUBMITTED", "ABANDONED", "FILED"]);
// #35 Part A: a single global counter behind the generated diary numbers
// (TEST-000001-2026 etc.) — atomic via Postgres' own nextval(), so two
// concurrent filings can never be allotted the same number.
export const diaryNumberSeq = pgSequence("diary_number_seq", { startWith: 1, increment: 1 });
// Never VERIFIED — no Bar Council integration exists (#9 Part B). Nullable
// on the filings table: no value until a candidate has been typed.
export const advocateEnrolmentStatusEnum = pgEnum("advocate_enrolment_status", ["PENDING_CONFIRMATION", "RECORDED_UNVERIFIED"]);
// #10 Part B introduced COMPLAINANT; #11 Part B reuses this exact same
// table/enum for ACCUSED — no second implementation, no schema change.
export const filingPartyRoleEnum = pgEnum("filing_party_role", ["COMPLAINANT", "ACCUSED"]);
export const filingPartyStatusEnum = pgEnum("filing_party_status", ["DRAFT", "CONFIRMED"]);
// #33 Part A — describes the COMPLAINANT party's own representation (self
// vs. represented by an advocate). Nullable on filing_parties, and only
// ever set on the COMPLAINANT row — a distinct concept from #9's
// advocateEnrolment* columns on `filings`, which record the enrolment of
// whoever is operating this WhatsApp session, not the complainant's own.
export const complainantFilingAsRoleEnum = pgEnum("complainant_filing_as_role", ["SELF", "ADVOCATE_FOR_CLIENT"]);
// #33 Part B — only ever set on the ACCUSED row.
export const filingPartyEntityTypeEnum = pgEnum("filing_party_entity_type", ["INDIVIDUAL", "PROPRIETOR", "COMPANY"]);
// #31: one value per document-upload state (FILING_DOC_CHEQUE etc.) —
// unlike filing_party_role, a filing can have many rows per group (up to
// each group's max file count), never just one.
// #33 Part E adds "narrative" — the optional written-account upload,
// alternative to Part D's typed story.
export const filingDocumentGroupEnum = pgEnum("filing_document_group", ["cheque", "memo", "notice", "id", "support", "narrative"]);
// #33 Part C — the cheque's return reason, a fixed 4-option select.
export const filingReturnReasonEnum = pgEnum("filing_return_reason", ["funds", "stop", "acct", "sign"]);
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
  // #31: the 5 document-group prompts, sent when advancing into each state.
  "FILING_DOC_CHEQUE_PROMPT",
  "FILING_DOC_MEMO_PROMPT",
  "FILING_DOC_NOTICE_PROMPT",
  "FILING_DOC_ID_PROMPT",
  "FILING_DOC_SUPPORT_PROMPT",
  "FILING_DOC_ALL_RECEIVED",
  "COMPLAINANT_NAME_PROMPT",
  "COMPLAINANT_PHONE_PROMPT",
  "COMPLAINANT_EMAIL_PROMPT",
  "COMPLAINANT_ADDRESS_PROMPT",
  "COMPLAINANT_SUMMARY",
  "COMPLAINANT_REVIEW_ACTIONS",
  "COMPLAINANT_EDIT_FIELDS",
  "COMPLAINANT_RECORDED",
  "ACCUSED_NAME_PROMPT",
  "ACCUSED_PHONE_PROMPT",
  "ACCUSED_ADDRESS_PROMPT",
  "ACCUSED_SUMMARY",
  "ACCUSED_REVIEW_ACTIONS",
  "ACCUSED_EDIT_FIELDS",
  "ACCUSED_RECORDED",
  // #33 Part A: the two new leading Complainant-screen fields.
  "COMPLAINANT_ROLE_PROMPT",
  "COMPLAINANT_ENROL_PROMPT",
  // #33 Part B: the one new Accused-screen field.
  "ACCUSED_ENTITY_TYPE_PROMPT",
  // #33 Part C: cheque and notice particulars, one prompt per field.
  "FILING_CHEQUE_NUMBER_PROMPT",
  "FILING_CHEQUE_DATE_PROMPT",
  "FILING_AMOUNT_PROMPT",
  "FILING_BANK_BRANCH_PROMPT",
  "FILING_RETURN_REASON_PROMPT",
  "FILING_MEMO_DATE_PROMPT",
  "FILING_NOTICE_DATE_PROMPT",
  "FILING_SERVICE_DATE_PROMPT",
  "FILING_PART_PAYMENT_PROMPT",
  // #33 Part D: the narrative.
  "FILING_STORY_PROMPT",
  "FILING_WITNESS_PROMPT",
  // #33 Part E: the optional written-account upload.
  "FILING_WRITTEN_ACCOUNT_PROMPT",
  // #33 Part F: court, the combined Parts C-F review, and the declaration.
  "FILING_COURT_PROMPT",
  "FILING_REVIEW_SUMMARY",
  "FILING_REVIEW_ACTIONS",
  "FILING_EDIT_GROUP_PROMPT",
  "FILING_EDIT_CHEQUE_FIELD_PROMPT",
  "FILING_EDIT_NARRATIVE_FIELD_PROMPT",
  "FILING_DECLARE_PROMPT",
  "FILING_RECORDED",
  // #34 (Prototype parity - Phase 6): the draft-ready summary + its
  // Review-and-eSign/Edit-details actions, and the OTP prompt.
  "FILING_DRAFT_READY_SUMMARY",
  "FILING_DRAFT_READY_ACTIONS",
  "FILING_OTP_PROMPT",
  // #35 (Prototype parity - Phase 7): the filed acknowledgement + its
  // pay-fee action, the simulated fee-paid receipt, and the final
  // completion message.
  "FILING_FILED_SUMMARY",
  "FILING_FILED_ACTIONS",
  "FILING_FEE_PAID_MESSAGE",
  "FILING_DONE_MESSAGE",
  // #36 (Prototype parity - Phase 8): the sectioned "My cases" list, the
  // per-draft detail card, and the discard confirmation.
  "FILING_DRAFT_LIST_MESSAGE",
  "FILING_DRAFT_DETAIL_MESSAGE",
  "FILING_DRAFT_DISCARDED_MESSAGE",
  // #37: the read-only case-status screen's new actions ("Simulate scrutiny
  // defects" / "Main menu"), then the defect-alert/list, each defect's
  // prompt, the review summary/actions, and the resubmission acknowledgement.
  "FILING_CASE_STATUS_ACTIONS",
  "FILING_DEFECT_ALERT_MESSAGE",
  "FILING_DEFECT_LIST_MESSAGE",
  "FILING_DEFECT_ALERT_ACTIONS",
  "FILING_DEFECT_1_PROMPT",
  "FILING_DEFECT_2_PROMPT",
  "FILING_DEFECT_3_REASON_PROMPT",
  "FILING_DEFECT_3_DAYS_PROMPT",
  "FILING_DEFECT_REVIEW_SUMMARY",
  "FILING_DEFECT_REVIEW_ACTIONS",
  "FILING_DEFECT_SENT_MESSAGE",
  "FILING_DEFECT_SENT_ACTIONS",
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
    // #33 Part C — cheque and notice particulars. Amount is stored as text
    // (currency), never a float (Part C's own schema note). Bank/branch and
    // return reason are optional per the field table; every date is a plain
    // calendar date, no time component.
    chequeNumber: text("cheque_number"),
    chequeDate: date("cheque_date", { mode: "string" }),
    chequeAmount: text("cheque_amount"),
    bankBranch: text("bank_branch"),
    returnReason: filingReturnReasonEnum("return_reason"),
    memoDate: date("memo_date", { mode: "string" }),
    noticeDate: date("notice_date", { mode: "string" }),
    serviceDate: date("service_date", { mode: "string" }),
    partPayment: boolean("part_payment"),
    // #33 Part D — both nullable/optional; Part E's uploaded written
    // account (filing_documents, "narrative" group) is the alternative to
    // a typed narrative, not an additional requirement on top of it.
    narrative: text("narrative"),
    witnessPresent: boolean("witness_present"),
    // #33 Part F — the hardcoded 3-court list (Scope decisions: confirmed
    // hardcoded for the pilot). Stored as the exact selected label text,
    // matching this issue's own schema snippet (TEXT, not an enum).
    selectedCourt: text("selected_court"),
    // #33 Part F — when the declaration checkbox was accepted. Mirrors
    // testNoticeAcceptedAt/advocateEnrolmentConfirmedAt above: an auditable
    // timestamp for a one-time acceptance, nullable until it happens.
    declarationAcceptedAt: timestamp("declaration_accepted_at", { withTimezone: true }),
    // #35 Part B — set together with status "FILED" (see recordFiled).
    // diaryNumber is generated from diaryNumberSeq above, never hardcoded
    // and never reused across filings.
    diaryNumber: text("diary_number"),
    filedAt: timestamp("filed_at", { withTimezone: true }),
    // #35 Part B — set together when the simulated fee payment is
    // recorded (see recordFeePaid). courtFeeTransactionId is a fabricated
    // demo value (see filing-completion-sender.ts), clearly never a real
    // payment gateway reference — no real payment gateway is ever called.
    courtFeePaidAt: timestamp("court_fee_paid_at", { withTimezone: true }),
    courtFeeTransactionId: text("court_fee_transaction_id"),
    // #37 Part B — the scrutiny-defect correction flow. defectNotifiedAt is
    // set once (when the simulated alert is raised); the corrected cheque
    // number, delay reason, and days of delay are each written by their own
    // FILING_DEFECT_* state; defectResubmittedAt is set together with the
    // single review-confirm action (Part A has no separate declare/pay
    // state — matches the prototype's own single review-screen CTA).
    defectNotifiedAt: timestamp("defect_notified_at", { withTimezone: true }),
    defectCorrectedChequeNumber: text("defect_corrected_cheque_number"),
    defectDelayReason: text("defect_delay_reason"),
    defectDelayDays: integer("defect_delay_days"),
    defectResubmittedAt: timestamp("defect_resubmitted_at", { withTimezone: true }),
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
    // #33 Part A — COMPLAINANT-only (mirrors how emailNormalized above is
    // COMPLAINANT-only): whether the complainant is filing as themselves or
    // is represented by an advocate, and that advocate's enrolment number
    // when so. A distinct concept from `filings.advocateEnrolment*` (#9),
    // which is the session operator's own enrolment, not the complainant's.
    filingAsRole: complainantFilingAsRoleEnum("filing_as_role"),
    representativeEnrolmentNumber: text("representative_enrolment_number"),
    // #33 Part B — ACCUSED-only.
    entityType: filingPartyEntityTypeEnum("entity_type"),
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
 * One row per uploaded document (#31, Prototype parity — Phase 3) — unlike
 * `filing_parties`, there is no uniqueness on `(filing_id, document_group)`,
 * since a group can hold up to its own max file count (e.g. up to 5 for
 * `notice`). `storage_url` is the durable copy (Vercel Blob); Twilio's own
 * `MediaUrl` is never relied on for retrieval after upload — it is kept
 * only as an audit trail, and is expected to expire.
 */
export const filingDocuments = pgTable(
  "filing_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    filingId: uuid("filing_id")
      .notNull()
      .references(() => filings.id),
    documentGroup: filingDocumentGroupEnum("document_group").notNull(),
    storageUrl: text("storage_url").notNull(),
    contentType: text("content_type").notNull(),
    originalTwilioMediaUrl: text("original_twilio_media_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("filing_documents_filing_id_idx").on(table.filingId)],
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
