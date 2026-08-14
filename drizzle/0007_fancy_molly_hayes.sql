CREATE TYPE "public"."filing_document_group" AS ENUM('cheque', 'memo', 'notice', 'id', 'support');--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_DOC_CHEQUE' BEFORE 'COMPLAINANT_DETAILS_START';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_DOC_MEMO' BEFORE 'COMPLAINANT_DETAILS_START';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_DOC_NOTICE' BEFORE 'COMPLAINANT_DETAILS_START';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_DOC_ID' BEFORE 'COMPLAINANT_DETAILS_START';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_DOC_SUPPORT' BEFORE 'COMPLAINANT_DETAILS_START';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DOC_CHEQUE_PROMPT' BEFORE 'COMPLAINANT_NAME_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DOC_MEMO_PROMPT' BEFORE 'COMPLAINANT_NAME_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DOC_NOTICE_PROMPT' BEFORE 'COMPLAINANT_NAME_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DOC_ID_PROMPT' BEFORE 'COMPLAINANT_NAME_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DOC_SUPPORT_PROMPT' BEFORE 'COMPLAINANT_NAME_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DOC_ALL_RECEIVED' BEFORE 'COMPLAINANT_NAME_PROMPT';--> statement-breakpoint
CREATE TABLE "filing_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filing_id" uuid NOT NULL,
	"document_group" "filing_document_group" NOT NULL,
	"storage_url" text NOT NULL,
	"content_type" text NOT NULL,
	"original_twilio_media_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "filing_documents" ADD CONSTRAINT "filing_documents_filing_id_filings_id_fk" FOREIGN KEY ("filing_id") REFERENCES "public"."filings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "filing_documents_filing_id_idx" ON "filing_documents" USING btree ("filing_id");