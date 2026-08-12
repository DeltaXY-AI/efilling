CREATE TYPE "public"."webhook_provider" AS ENUM('twilio', 'kapso');--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "business_scoped_user_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "whatsapp_username" text;--> statement-breakpoint
ALTER TABLE "processed_webhook_events" ADD COLUMN "provider" "webhook_provider" DEFAULT 'twilio' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_business_scoped_user_id_unique" UNIQUE("business_scoped_user_id");