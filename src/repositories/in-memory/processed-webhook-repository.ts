import type { ProcessedWebhookRepository, WebhookEventOutcome, WebhookEventProvider } from "../processed-webhook-repository";

interface StoredEvent {
  eventType: string;
  whatsappNumberMaskedOrHash?: string;
  provider: WebhookEventProvider;
  status: "processing" | WebhookEventOutcome;
  errorCode?: string;
}

/** In-memory ProcessedWebhookRepository for tests — never used in production. */
export class InMemoryProcessedWebhookRepository implements ProcessedWebhookRepository {
  private readonly byMessageSid = new Map<string, StoredEvent>();

  async tryClaim(
    messageSid: string,
    eventType: string,
    whatsappNumberMaskedOrHash?: string,
    provider: WebhookEventProvider = "twilio",
  ): Promise<boolean> {
    if (this.byMessageSid.has(messageSid)) {
      return false;
    }
    this.byMessageSid.set(messageSid, { eventType, whatsappNumberMaskedOrHash, provider, status: "processing" });
    return true;
  }

  async markOutcome(messageSid: string, outcome: WebhookEventOutcome, errorCode?: string): Promise<void> {
    const existing = this.byMessageSid.get(messageSid);
    if (!existing) {
      throw new Error(`InMemoryProcessedWebhookRepository: no claimed event for ${messageSid}`);
    }
    this.byMessageSid.set(messageSid, { ...existing, status: outcome, errorCode });
  }
}
