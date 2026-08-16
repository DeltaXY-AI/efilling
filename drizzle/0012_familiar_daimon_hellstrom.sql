ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_DRAFT_LIST';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_DRAFT_DETAIL';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DRAFT_LIST_MESSAGE';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DRAFT_DETAIL_MESSAGE';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DRAFT_DISCARDED_MESSAGE';