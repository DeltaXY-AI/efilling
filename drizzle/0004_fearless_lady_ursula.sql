CREATE TYPE "public"."outbound_message_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."outbound_message_type" AS ENUM('FILING_NOTICE', 'FILING_DRAFT_CHOICE', 'FILING_DRAFT_CREATED', 'FILING_RESUMED', 'MAIN_MENU');--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_type" "outbound_message_type" NOT NULL,
	"language" "conversation_language" NOT NULL,
	"status" "outbound_message_status" DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbound_messages_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;