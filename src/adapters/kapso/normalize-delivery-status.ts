import type { OutboundDeliveryStatus } from "../../repositories/outbound-message-repository";

interface KapsoStatusError {
  code?: number;
  title?: string;
  message?: string;
}

interface KapsoStatusEntry {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: KapsoStatusError[];
}

/** Shape of a `whatsapp.message.sent|delivered|read|failed` Kapso webhook payload. */
export interface KapsoStatusWebhookBody {
  message?: {
    id?: string;
    timestamp?: string;
    kapso?: {
      status?: string;
      statuses?: KapsoStatusEntry[];
    };
  };
}

export interface NormalizedDeliveryStatus {
  providerMessageId: string;
  status: OutboundDeliveryStatus;
  occurredAt: Date;
  errorCode?: string;
}

const VALID_STATUSES: ReadonlySet<string> = new Set<OutboundDeliveryStatus>(["sent", "delivered", "read", "failed"]);

/**
 * Translates a Kapso delivery-status webhook payload into zero or more
 * provider-neutral status updates. Kapso's own buffering can batch several
 * status transitions into one webhook call, so this always returns an
 * array — never assume exactly one. Malformed or forward-compatible-unknown
 * entries (a status value this deployment doesn't recognize) are skipped
 * rather than thrown on, since a new Kapso event type must not crash the
 * webhook handler.
 */
export function normalizeKapsoDeliveryStatuses(body: KapsoStatusWebhookBody): NormalizedDeliveryStatus[] {
  const entries = body.message?.kapso?.statuses ?? [];
  const results: NormalizedDeliveryStatus[] = [];

  for (const entry of entries) {
    if (!entry.id || !entry.status || !VALID_STATUSES.has(entry.status)) {
      continue;
    }

    const occurredAt = entry.timestamp ? new Date(Number(entry.timestamp) * 1000) : new Date();
    const errorCode = entry.errors?.[0]?.code !== undefined ? String(entry.errors[0].code) : undefined;

    results.push({ providerMessageId: entry.id, status: entry.status as OutboundDeliveryStatus, occurredAt, errorCode });
  }

  return results;
}
