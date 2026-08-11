export type WebhookEventOutcome = "processed" | "failed";

/**
 * Durable idempotency record for inbound Twilio webhook deliveries, keyed by
 * Twilio's unique `MessageSid`. Prevents a Twilio retry from re-sending the
 * language picker or a confirmation a second time.
 */
export interface ProcessedWebhookRepository {
  /**
   * Atomically claims a `messageSid` for processing. Returns `true` the
   * first time a given `messageSid` is claimed, and `false` on every
   * subsequent call (a duplicate delivery) — callers must not run workflow
   * side effects again when this returns `false`.
   */
  tryClaim(messageSid: string, eventType: string, whatsappNumberMaskedOrHash?: string): Promise<boolean>;

  /** Records the final outcome of processing a previously-claimed messageSid. */
  markOutcome(messageSid: string, outcome: WebhookEventOutcome, errorCode?: string): Promise<void>;
}
