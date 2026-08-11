CREATE TYPE "public"."conversation_language" AS ENUM('en', 'ml');--> statement-breakpoint
CREATE TYPE "public"."conversation_state" AS ENUM('NEW', 'AWAITING_LANGUAGE', 'MAIN_MENU');--> statement-breakpoint
CREATE TYPE "public"."webhook_event_status" AS ENUM('processing', 'processed', 'failed');--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"whatsapp_number" text NOT NULL,
	"language" "conversation_language",
	"state" "conversation_state" DEFAULT 'NEW' NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_whatsapp_number_unique" UNIQUE("whatsapp_number")
);
--> statement-breakpoint
CREATE TABLE "processed_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_sid" text NOT NULL,
	"event_type" text NOT NULL,
	"whatsapp_number_masked_or_hash" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"status" "webhook_event_status" DEFAULT 'processing' NOT NULL,
	"error_code" text,
	CONSTRAINT "processed_webhook_events_message_sid_unique" UNIQUE("message_sid")
);
