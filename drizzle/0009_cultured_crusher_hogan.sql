CREATE TYPE "public"."complainant_filing_as_role" AS ENUM('SELF', 'ADVOCATE_FOR_CLIENT');--> statement-breakpoint
CREATE TYPE "public"."filing_party_entity_type" AS ENUM('INDIVIDUAL', 'PROPRIETOR', 'COMPANY');--> statement-breakpoint
CREATE TYPE "public"."filing_return_reason" AS ENUM('funds', 'stop', 'acct', 'sign');--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'ACCUSED_ENTITY_TYPE_PENDING' BEFORE 'CHEQUE_DETAILS_START';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'ACCUSED_EDIT_ENTITY_TYPE_PENDING' BEFORE 'CHEQUE_DETAILS_START';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'COMPLAINANT_ROLE_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'COMPLAINANT_ENROL_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'COMPLAINANT_EDIT_ROLE_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'COMPLAINANT_EDIT_ENROL_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_CHEQUE_NUMBER_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_CHEQUE_DATE_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_AMOUNT_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_BANK_BRANCH_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_RETURN_REASON_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_MEMO_DATE_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_NOTICE_DATE_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_SERVICE_DATE_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_PART_PAYMENT_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_STORY_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_WITNESS_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_WRITTEN_ACCOUNT_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_COURT_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_REVIEW';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_DECLARE_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_EDIT_GROUP_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_EDIT_CHEQUE_FIELD_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_EDIT_NARRATIVE_FIELD_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_EDIT_CHEQUE_NUMBER_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_EDIT_CHEQUE_DATE_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_EDIT_AMOUNT_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_EDIT_BANK_BRANCH_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_EDIT_RETURN_REASON_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_EDIT_MEMO_DATE_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_EDIT_NOTICE_DATE_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_EDIT_SERVICE_DATE_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_EDIT_PART_PAYMENT_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_EDIT_STORY_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_EDIT_WITNESS_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_EDIT_COURT_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'DRAFT_READY_START';--> statement-breakpoint
ALTER TYPE "public"."filing_document_group" ADD VALUE 'narrative';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'COMPLAINANT_ROLE_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'COMPLAINANT_ENROL_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'ACCUSED_ENTITY_TYPE_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_CHEQUE_NUMBER_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_CHEQUE_DATE_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_AMOUNT_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_BANK_BRANCH_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_RETURN_REASON_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_MEMO_DATE_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_NOTICE_DATE_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_SERVICE_DATE_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_PART_PAYMENT_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_STORY_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_WITNESS_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_WRITTEN_ACCOUNT_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_COURT_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_REVIEW_SUMMARY';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_REVIEW_ACTIONS';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_EDIT_GROUP_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_EDIT_CHEQUE_FIELD_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_EDIT_NARRATIVE_FIELD_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DECLARE_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_RECORDED';--> statement-breakpoint
ALTER TABLE "filing_parties" ADD COLUMN "filing_as_role" "complainant_filing_as_role";--> statement-breakpoint
ALTER TABLE "filing_parties" ADD COLUMN "representative_enrolment_number" text;--> statement-breakpoint
ALTER TABLE "filing_parties" ADD COLUMN "entity_type" "filing_party_entity_type";--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "cheque_number" text;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "cheque_date" date;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "cheque_amount" text;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "bank_branch" text;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "return_reason" "filing_return_reason";--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "memo_date" date;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "notice_date" date;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "service_date" date;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "part_payment" boolean;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "narrative" text;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "witness_present" boolean;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "selected_court" text;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "declaration_accepted_at" timestamp with time zone;