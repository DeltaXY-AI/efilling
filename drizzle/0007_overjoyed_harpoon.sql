ALTER TYPE "public"."conversation_state" ADD VALUE 'ACCUSED_NAME_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'ACCUSED_PHONE_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'ACCUSED_ADDRESS_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'ACCUSED_CONFIRM';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'ACCUSED_EDIT_FIELD';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'ACCUSED_EDIT_NAME_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'ACCUSED_EDIT_PHONE_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'ACCUSED_EDIT_ADDRESS_PENDING';--> statement-breakpoint
ALTER TYPE "public"."conversation_state" ADD VALUE 'CHEQUE_DETAILS_START';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'ACCUSED_NAME_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'ACCUSED_PHONE_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'ACCUSED_ADDRESS_PROMPT';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'ACCUSED_SUMMARY';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'ACCUSED_REVIEW_ACTIONS';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'ACCUSED_EDIT_FIELDS';--> statement-breakpoint
ALTER TYPE "public"."outbound_message_type" ADD VALUE 'ACCUSED_RECORDED';