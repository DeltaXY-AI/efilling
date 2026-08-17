ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_CASE_TYPE_PENDING' BEFORE 'FILING_NOTICE';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'FILING_OTHER_CASE_TYPES_PENDING' BEFORE 'FILING_NOTICE';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_CASE_TYPE_PROMPT' BEFORE 'FILING_NOTICE';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_CASE_TYPE_OTHER_INFO' BEFORE 'FILING_NOTICE';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_OTHER_CASE_TYPES_PROMPT' BEFORE 'FILING_NOTICE';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'FILING_CASE_TYPE_UNAVAILABLE_INFO' BEFORE 'FILING_NOTICE';