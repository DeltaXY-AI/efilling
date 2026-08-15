ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_DRAFT_READY';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_OTP_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_FILED_START';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DRAFT_READY_SUMMARY';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_DRAFT_READY_ACTIONS';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_OTP_PROMPT';