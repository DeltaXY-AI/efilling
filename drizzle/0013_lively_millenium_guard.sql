ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_DEFECT_ALERT';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_DEFECT_1';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_DEFECT_2';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_DEFECT_3';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_DEFECT_REVIEW';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_DEFECT_SENT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_CASE_STATUS_ACTIONS';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DEFECT_ALERT_MESSAGE';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DEFECT_LIST_MESSAGE';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DEFECT_ALERT_ACTIONS';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DEFECT_1_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DEFECT_2_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DEFECT_3_REASON_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DEFECT_3_DAYS_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DEFECT_REVIEW_SUMMARY';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DEFECT_REVIEW_ACTIONS';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DEFECT_SENT_MESSAGE';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DEFECT_SENT_ACTIONS';--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "defect_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "defect_corrected_cheque_number" text;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "defect_delay_reason" text;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "defect_delay_days" integer;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "defect_resubmitted_at" timestamp with time zone;