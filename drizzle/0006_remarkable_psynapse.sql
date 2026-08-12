CREATE TYPE "public"."outbound_delivery_status" AS ENUM('sent', 'delivered', 'read', 'failed');--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "delivery_status" "outbound_delivery_status";--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "delivery_status_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "delivery_error_code" text;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_provider_message_id_unique" UNIQUE("provider_message_id");