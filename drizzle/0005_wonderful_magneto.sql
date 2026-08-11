CREATE TYPE "public"."advocate_enrolment_status" AS ENUM('PENDING_CONFIRMATION', 'RECORDED_UNVERIFIED');--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'ADVOCATE_ENROLMENT_CONFIRM';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'COMPLAINANT_DETAILS_START';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'ADVOCATE_ENROLMENT_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'ADVOCATE_ENROLMENT_CONFIRM';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'ADVOCATE_ENROLMENT_RECORDED';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_SAVED';--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "advocate_enrolment_original" text;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "advocate_enrolment_normalized" text;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "advocate_enrolment_status" "advocate_enrolment_status";--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "advocate_enrolment_confirmed_at" timestamp with time zone;