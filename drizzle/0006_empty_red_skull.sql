CREATE TYPE "public"."filing_party_role" AS ENUM('COMPLAINANT', 'ACCUSED');--> statement-breakpoint
CREATE TYPE "public"."filing_party_status" AS ENUM('DRAFT', 'CONFIRMED');--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'COMPLAINANT_NAME_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'COMPLAINANT_PHONE_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'COMPLAINANT_EMAIL_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'COMPLAINANT_ADDRESS_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'COMPLAINANT_CONFIRM';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'COMPLAINANT_EDIT_FIELD';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'COMPLAINANT_EDIT_NAME_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'COMPLAINANT_EDIT_PHONE_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'COMPLAINANT_EDIT_EMAIL_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'COMPLAINANT_EDIT_ADDRESS_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'ACCUSED_DETAILS_START';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'COMPLAINANT_NAME_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'COMPLAINANT_PHONE_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'COMPLAINANT_EMAIL_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'COMPLAINANT_ADDRESS_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'COMPLAINANT_SUMMARY';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'COMPLAINANT_REVIEW_ACTIONS';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'COMPLAINANT_EDIT_FIELDS';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'COMPLAINANT_RECORDED';--> statement-breakpoint
CREATE TABLE "filing_parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filing_id" uuid NOT NULL,
	"party_role" "filing_party_role" NOT NULL,
	"full_name" text,
	"phone_original" text,
	"phone_normalized" text,
	"email_normalized" text,
	"address" text,
	"status" "filing_party_status" DEFAULT 'DRAFT' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "filing_parties" ADD CONSTRAINT "filing_parties_filing_id_filings_id_fk" FOREIGN KEY ("filing_id") REFERENCES "public"."filings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "filing_parties_filing_role_unique" ON "filing_parties" USING btree ("filing_id","party_role");--> statement-breakpoint
CREATE INDEX "filing_parties_filing_id_idx" ON "filing_parties" USING btree ("filing_id");