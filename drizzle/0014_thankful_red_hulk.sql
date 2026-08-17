ALTER TYPE "public"."conversation_state" ADD VALUE 'HEARING_ADJOURN_GROUND_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'HEARING_ADJOURN_DATE_PENDING';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'HEARING_REMINDER_MESSAGE';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'HEARING_ATTEND_OK_MESSAGE';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'HEARING_ADJOURN_INTRO_MESSAGE';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'HEARING_ADJOURN_DATE_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'HEARING_ADJOURN_FILED_MESSAGE';--> statement-breakpoint
CREATE SEQUENCE "public"."ia_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "next_hearing_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "hearing_attendance" text;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "adjournment_ground" text;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "adjournment_requested_date" date;--> statement-breakpoint
ALTER TABLE "filings" ADD COLUMN "adjournment_ia_number" text;