CREATE TYPE "public"."filing_role" AS ENUM('COMPLAINANT_ADVOCATE');--> statement-breakpoint
CREATE TYPE "public"."filing_status" AS ENUM('DRAFT', 'SUBMITTED', 'ABANDONED');--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_DRAFT_CHOICE';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_NOTICE';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'ADVOCATE_ENROLMENT_PENDING';--> statement-breakpoint
CREATE TABLE "filings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "filing_role" DEFAULT 'COMPLAINANT_ADVOCATE' NOT NULL,
	"status" "filing_status" DEFAULT 'DRAFT' NOT NULL,
	"current_step" text NOT NULL,
	"language" "conversation_language" NOT NULL,
	"test_notice_version" text,
	"test_notice_accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "active_filing_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "filings" ADD CONSTRAINT "filings_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "filings_conversation_status_idx" ON "filings" USING btree ("conversation_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_active_filing_id_filings_id_fk" FOREIGN KEY ("active_filing_id") REFERENCES "public"."filings"("id") ON DELETE no action ON UPDATE no action;