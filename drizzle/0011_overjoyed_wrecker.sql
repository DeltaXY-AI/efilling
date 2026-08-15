ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_FILED';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_DONE';--> statement-breakpoint
ALTER TYPE "public"."filing_status" ADD VALUE 'FILED';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_FILED_SUMMARY';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_FILED_ACTIONS';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_FEE_PAID_MESSAGE';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DONE_MESSAGE';--> statement-breakpoint
CREATE SEQUENCE "public"."diary_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "diary_number" text;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "filed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "court_fee_paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "court_fee_transaction_id" text;