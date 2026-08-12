export type WebhookEventOutcome = "processed" | "failed";
export type WebhookEventProvider = "twilio" | "kapso";

/**
 * Durable idempotency record for inbound webhook deliveries, keyed by the
 * provider's own message/event id (Twilio's `MessageSid` today; a Kapso
 * `wamid` under the #16 spike). Prevents a retried delivery from re-sending
 * the language picker or a confirmation a second time.
 */
export interface ProcessedWebhookRepository {
  /**
   * Atomically claims a `messageSid` for processing. Returns `true` the
   * first time a given `messageSid` is claimed, and `false` on every
   * subsequent call (a duplicate delivery) — callers must not run workflow
   * side effects again when this returns `false`. `provider` defaults to
   * "twilio" so existing call sites need no change.
   */
  tryClaim(
    messageSid: string,
    eventType: string,
    whatsappNumberMaskedOrHash?: string,
    provider?: WebhookEventProvider,
  ): Promise<boolean>;

  /** Records the final outcome of processing a previously-claimed messageSid. */
  markOutcome(messageSid: string, outcome: WebhookEventOutcome, errorCode?: string): Promise<void>;
}
