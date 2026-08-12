/**
 * Masks a sender identifier (e.g. "whatsapp:+14155238886") for logging,
 * keeping any provider prefix and the last 4 characters, and replacing the
 * rest with asterisks. Never log an unmasked sender.
 */
export function maskSender(value: string): string {
  const [, prefix = "", rest = value] = value.match(/^([a-z]+:)?(.*)$/i) ?? [];

  if (rest.length <= 4) {
    return `${prefix}${"*".repeat(rest.length)}`;
  }

  const visible = rest.slice(-4);
  const masked = "*".repeat(rest.length - 4);
  return `${prefix}${masked}${visible}`;
}

interface WebhookLogEvent {
  route: string;
  status: number;
  outcome: "accepted" | "invalid_signature";
  messageId?: string;
  mediaCount?: number;
  from?: string;
}

/**
 * Emits a single structured log line for a webhook request. Only ever pass
 * fields that are safe to log — never the Twilio Auth Token, the request
 * signature, the raw message body/text, or media URLs.
 */
export function logWebhookEvent(event: WebhookLogEvent): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      route: event.route,
      status: event.status,
      outcome: event.outcome,
      messageId: event.messageId,
      mediaCount: event.mediaCount,
      from: event.from ? maskSender(event.from) : undefined,
    }),
  );
}

interface WorkflowLogErrorEvent {
  /** A safe, non-sensitive error code — never the raw Twilio error/exception. */
  code: string;
  /** Twilio MessageSid, for correlating with Twilio's own logs. */
  correlationId?: string;
}

/** Logs a workflow failure using only a safe error code and correlation id. */
export function logWorkflowError(event: WorkflowLogErrorEvent): void {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      code: event.code,
      correlationId: event.correlationId,
    }),
  );
}

interface DeliveryStatusLogEvent {
  /** The provider's own message id (Twilio MessageSid / Kapso wamid) — never the message body it refers to. */
  providerMessageId: string;
  status: string;
  /** False when no outbound_messages row has this providerMessageId — not necessarily an error (#16 task 7); worth watching if it recurs. */
  matched: boolean;
}

/** Logs a delivery-status webhook's outcome (sent/delivered/read/failed reconciliation) — never the message content it refers to. */
export function logDeliveryStatusEvent(event: DeliveryStatusLogEvent): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      type: "delivery_status",
      providerMessageId: event.providerMessageId,
      status: event.status,
      matched: event.matched,
    }),
  );
}
