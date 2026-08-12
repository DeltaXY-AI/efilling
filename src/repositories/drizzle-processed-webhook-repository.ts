import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { processedWebhookEvents } from "../db/schema";
import type { ProcessedWebhookRepository, WebhookEventOutcome, WebhookEventProvider } from "./processed-webhook-repository";

export class DrizzleProcessedWebhookRepository implements ProcessedWebhookRepository {
  async tryClaim(
    messageSid: string,
    eventType: string,
    whatsappNumberMaskedOrHash?: string,
    provider: WebhookEventProvider = "twilio",
  ): Promise<boolean> {
    const db = getDb();
    const inserted = await db
      .insert(processedWebhookEvents)
      .values({
        messageSid,
        provider,
        eventType,
        whatsappNumberMaskedOrHash,
        status: "processing",
      })
      // The unique constraint on message_sid is what makes this atomic: a
      // concurrent/retried delivery for the same MessageSid loses the race
      // and gets zero rows back instead of a duplicate-key error.
      .onConflictDoNothing({ target: processedWebhookEvents.messageSid })
      .returning({ id: processedWebhookEvents.id });

    return inserted.length > 0;
  }

  async markOutcome(messageSid: string, outcome: WebhookEventOutcome, errorCode?: string): Promise<void> {
    const db = getDb();
    await db
      .update(processedWebhookEvents)
      .set({ status: outcome, processedAt: sql`now()`, errorCode: errorCode ?? null })
      .where(eq(processedWebhookEvents.messageSid, messageSid));
  }
}
