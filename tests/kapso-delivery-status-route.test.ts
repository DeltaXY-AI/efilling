import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { InMemoryProcessedWebhookRepository } from "../src/repositories/in-memory/processed-webhook-repository";
import { InMemoryFilingRepository } from "../src/repositories/in-memory/filing-repository";
import { InMemoryOutboundMessageRepository } from "../src/repositories/in-memory/outbound-message-repository";
import { createInMemoryWithTransaction } from "../src/repositories/in-memory/transaction";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";
import { KAPSO_ROUTE_PATH } from "../src/routes/kapso-webhook.route";

const ROUTE_PATH = KAPSO_ROUTE_PATH;
const WEBHOOK_SECRET = "test-kapso-webhook-secret";
const TEMPLATES_NOT_YET_WIRED = "kapso-template-not-yet-wired";
const FROM_NUMBER = "617991234500";
const WHATSAPP_NUMBER = "15005551111";

function sign(rawBody: string): string {
  return createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
}

function statusBody(entries: Array<{ id: string; status: string; timestamp?: string; errors?: Array<{ code: number }> }>) {
  return JSON.stringify({ message: { kapso: { statuses: entries } } });
}

async function post(app: ReturnType<typeof createApp>, eventType: string, rawBody: string) {
  return request(app)
    .post(ROUTE_PATH)
    .set("Content-Type", "application/json")
    .set("X-Webhook-Event", eventType)
    .set("X-Webhook-Signature", sign(rawBody))
    .send(rawBody);
}

describe("Kapso delivery-status webhooks (#16 task 7)", () => {
  let conversationRepo: InMemoryConversationRepository;
  let outboundMessageRepo: InMemoryOutboundMessageRepository;
  let messagingClient: FakeMessagingClient;
  let app: ReturnType<typeof createApp>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    conversationRepo = new InMemoryConversationRepository();
    outboundMessageRepo = new InMemoryOutboundMessageRepository();
    messagingClient = createFakeMessagingClient({ interactive: true });

    const mainMenuSenderDeps = { messagingClient, fromNumber: FROM_NUMBER, contentSidByLanguage: { en: TEMPLATES_NOT_YET_WIRED, ml: TEMPLATES_NOT_YET_WIRED } };
    app = createApp({
      kapsoWebhookDeps: {
        conversationRepo,
        processedWebhookRepo: new InMemoryProcessedWebhookRepository(),
        webhookSecret: WEBHOOK_SECRET,
        languageWorkflowDeps: {
          conversationRepo,
          messagingClient,
          fromNumber: FROM_NUMBER,
          contentSid: TEMPLATES_NOT_YET_WIRED,
          mainMenuContentSid: { en: TEMPLATES_NOT_YET_WIRED, ml: TEMPLATES_NOT_YET_WIRED },
        },
        mainMenuSenderDeps,
        filingWorkflowDeps: {
          conversationRepo,
          filingRepo: new InMemoryFilingRepository(conversationRepo),
          outboundMessageRepo,
          filingSenderDeps: {
            messagingClient,
            fromNumber: FROM_NUMBER,
            draftChoiceContentSid: { en: TEMPLATES_NOT_YET_WIRED, ml: TEMPLATES_NOT_YET_WIRED },
            noticeContentSid: { en: TEMPLATES_NOT_YET_WIRED, ml: TEMPLATES_NOT_YET_WIRED },
          },
          mainMenuSenderDeps,
          withTransaction: createInMemoryWithTransaction(),
        },
      },
    });

    // Drive a real conversation to MAIN_MENU, then trigger menu:file-case so
    // an outbound_messages row actually gets enqueued and markSent — the
    // fake messaging client's send methods all resolve to the same
    // "fake-message-id", which is what we'll reconcile a status event against.
    await conversationRepo.createAwaitingLanguage(WHATSAPP_NUMBER, new Date());
    await conversationRepo.setLanguageAndMainMenu(WHATSAPP_NUMBER, "en", new Date());
  });

  async function triggerFileCaseSend(): Promise<string> {
    const body = JSON.stringify({
      message: { id: `wamid.trigger-${Math.random()}`, from: WHATSAPP_NUMBER, type: "interactive", interactive: { button_reply: { id: "menu:file-case", title: "File" } } },
    });
    const response = await post(app, "whatsapp.message.received", body);
    expect(response.status).toBe(200);

    const conversation = await conversationRepo.findByWhatsappNumber(WHATSAPP_NUMBER);
    // menu:file-case with no active draft enqueues a FILING_NOTICE outbound
    // row via sendFilingNotice → the fake client → "fake-message-id".
    const record = outboundMessageRepo.findByDedupeKey(`${JSON.parse(body).message.id}:filing-notice`);
    expect(record).not.toBeNull();
    expect(conversation?.state).toBe("FILING_NOTICE");
    return record!.id;
  }

  it("reconciles a delivered status webhook against the outbound row markSent recorded", async () => {
    const outboundId = await triggerFileCaseSend();
    expect(outboundMessageRepo.findById(outboundId)).toMatchObject({ providerMessageId: "fake-message-id", deliveryStatus: null });

    const body = statusBody([{ id: "fake-message-id", status: "delivered", timestamp: "1700000000" }]);
    const response = await post(app, "whatsapp.message.delivered", body);

    expect(response.status).toBe(200);
    expect(outboundMessageRepo.findById(outboundId)).toMatchObject({ deliveryStatus: "delivered" });
  });

  it("processes sent, delivered, and read as distinct events for the same message id, not duplicates of each other", async () => {
    const outboundId = await triggerFileCaseSend();

    await post(app, "whatsapp.message.sent", statusBody([{ id: "fake-message-id", status: "sent", timestamp: "1700000001" }]));
    await post(app, "whatsapp.message.delivered", statusBody([{ id: "fake-message-id", status: "delivered", timestamp: "1700000002" }]));
    await post(app, "whatsapp.message.read", statusBody([{ id: "fake-message-id", status: "read", timestamp: "1700000003" }]));

    expect(outboundMessageRepo.findById(outboundId)).toMatchObject({ deliveryStatus: "read" });
  });

  it("does not reprocess a retried delivery of the exact same status event", async () => {
    const outboundId = await triggerFileCaseSend();
    const body = statusBody([{ id: "fake-message-id", status: "delivered", timestamp: "1700000000" }]);

    await post(app, "whatsapp.message.delivered", body);
    await post(app, "whatsapp.message.delivered", body);

    // Both requests 200 (idempotent no-op on the retry), and the record is
    // simply "delivered" — not left in some doubly-applied inconsistent state.
    expect(outboundMessageRepo.findById(outboundId)).toMatchObject({ deliveryStatus: "delivered" });
  });

  it("safely logs matched: false for a status event referencing a message id this deployment never sent, instead of erroring", async () => {
    const body = statusBody([{ id: "wamid.never-sent", status: "delivered", timestamp: "1700000000" }]);

    const response = await post(app, "whatsapp.message.delivered", body);

    expect(response.status).toBe(200);
    const logged = logSpy.mock.calls.map((call: unknown[]) => call[0] as string).find((line: string) => line.includes("wamid.never-sent"));
    expect(logged && JSON.parse(logged)).toMatchObject({ type: "delivery_status", providerMessageId: "wamid.never-sent", matched: false });
  });

  it("rejects a delivery-status webhook with an invalid signature before touching the repository", async () => {
    const outboundId = await triggerFileCaseSend();
    const body = statusBody([{ id: "fake-message-id", status: "delivered", timestamp: "1700000000" }]);

    const response = await request(app)
      .post(ROUTE_PATH)
      .set("Content-Type", "application/json")
      .set("X-Webhook-Event", "whatsapp.message.delivered")
      .set("X-Webhook-Signature", "not-valid")
      .send(body);

    expect(response.status).toBe(403);
    expect(outboundMessageRepo.findById(outboundId)).toMatchObject({ deliveryStatus: null });
  });

  it("safely acks and no-ops an unrecognized event type rather than guessing at its shape", async () => {
    const body = JSON.stringify({ message: { id: "wamid.mystery" } });

    const response = await post(app, "whatsapp.some_future_event", body);

    expect(response.status).toBe(200);
  });
});
