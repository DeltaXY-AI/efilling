import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { InMemoryProcessedWebhookRepository } from "../src/repositories/in-memory/processed-webhook-repository";
import { InMemoryFilingRepository } from "../src/repositories/in-memory/filing-repository";
import { InMemoryOutboundMessageRepository } from "../src/repositories/in-memory/outbound-message-repository";
import { createInMemoryWithTransaction } from "../src/repositories/in-memory/transaction";
import type { ProcessedWebhookRepository } from "../src/repositories/processed-webhook-repository";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";
import { KAPSO_ROUTE_PATH } from "../src/routes/kapso-webhook.route";

const ROUTE_PATH = KAPSO_ROUTE_PATH;
const WEBHOOK_SECRET = "test-kapso-webhook-secret";
const TEMPLATES_NOT_YET_WIRED = "kapso-template-not-yet-wired";
const FROM_NUMBER = "617991234500"; // KAPSO_PHONE_NUMBER_ID stand-in for tests

function sign(rawBody: string): string {
  return createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
}

function findLoggedEvent(logSpy: ReturnType<typeof vi.spyOn>, messageId: string): Record<string, unknown> {
  const loggedLine = logSpy.mock.calls
    .map((call: unknown[]) => call[0])
    .find((line: unknown): line is string => typeof line === "string" && line.includes(messageId));

  expect(loggedLine).toBeDefined();
  return JSON.parse(loggedLine as string);
}

function buildDeps(
  conversationRepo: InMemoryConversationRepository,
  processedWebhookRepo: ProcessedWebhookRepository,
  messagingClient: FakeMessagingClient,
) {
  const mainMenuSenderDeps = { messagingClient, fromNumber: FROM_NUMBER, contentSidByLanguage: { en: TEMPLATES_NOT_YET_WIRED, ml: TEMPLATES_NOT_YET_WIRED } };
  return {
    conversationRepo,
    processedWebhookRepo,
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
      outboundMessageRepo: new InMemoryOutboundMessageRepository(),
      filingSenderDeps: {
        messagingClient,
        fromNumber: FROM_NUMBER,
        draftChoiceContentSid: { en: TEMPLATES_NOT_YET_WIRED, ml: TEMPLATES_NOT_YET_WIRED },
        noticeContentSid: { en: TEMPLATES_NOT_YET_WIRED, ml: TEMPLATES_NOT_YET_WIRED },
      },
      mainMenuSenderDeps,
      withTransaction: createInMemoryWithTransaction(),
    },
  };
}

describe("POST /webhooks/kapso/whatsapp", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let messagingClient: FakeMessagingClient;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    // The real Kapso client always has native interactive buttons/lists
    // (#16 task 6) — matching that shape here so these route tests exercise
    // what actually happens, not a hypothetical Kapso-without-interactive.
    messagingClient = createFakeMessagingClient({ interactive: true });
    app = createApp({
      kapsoWebhookDeps: buildDeps(new InMemoryConversationRepository(), new InMemoryProcessedWebhookRepository(), messagingClient),
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("accepts a validly signed text message and opens the language picker", async () => {
    const rawBody = JSON.stringify({ message: { id: "wamid.kapso1", from: "15005550006", type: "text", text: { body: "Hi" } } });

    const response = await request(app)
      .post(ROUTE_PATH)
      .set("Content-Type", "application/json")
      .set("X-Webhook-Signature", sign(rawBody))
      .send(rawBody);

    expect(response.status).toBe(200);

    const logged = findLoggedEvent(logSpy, "wamid.kapso1");
    expect(logged).toMatchObject({ status: 200, outcome: "accepted", mediaCount: 0 });

    // Native interactive buttons, not the Content Template — Kapso has no
    // SID equivalent, so the language picker goes out as real Kapso/Meta
    // interactive structure (#16 task 6), not a fallback.
    expect(messagingClient.sendInteractiveButtons).toHaveBeenCalledWith({
      from: FROM_NUMBER,
      to: "15005550006",
      bodyText: expect.stringContaining("Please choose your preferred language"),
      buttons: [
        { id: "language:en", title: "English" },
        { id: "language:ml", title: "മലയാളം" },
      ],
    });
    expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();
  });

  it("rejects a request with an invalid signature and never dispatches", async () => {
    const rawBody = JSON.stringify({ message: { id: "wamid.kapso2", from: "15005550006", text: { body: "Hi" } } });

    const response = await request(app)
      .post(ROUTE_PATH)
      .set("Content-Type", "application/json")
      .set("X-Webhook-Signature", "definitely-not-valid")
      .send(rawBody);

    expect(response.status).toBe(403);
    expect(messagingClient.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();
  });

  it("rejects a request with a missing signature", async () => {
    const rawBody = JSON.stringify({ message: { id: "wamid.kapso3", from: "15005550006", text: { body: "Hi" } } });

    const response = await request(app).post(ROUTE_PATH).set("Content-Type", "application/json").send(rawBody);

    expect(response.status).toBe(403);
  });

  it("rejects a signature computed over a different byte sequence than what was sent", async () => {
    const signedBody = JSON.stringify({ message: { id: "wamid.kapso4", from: "15005550006", text: { body: "Hi" } } });
    const sentBody = JSON.stringify({ message: { id: "wamid.kapso4", from: "15005550006", text: { body: "Tampered" } } });

    const response = await request(app)
      .post(ROUTE_PATH)
      .set("Content-Type", "application/json")
      .set("X-Webhook-Signature", sign(signedBody))
      .send(sentBody);

    expect(response.status).toBe(403);
  });

  it("does not send a second message for a duplicate wamid", async () => {
    const rawBody = JSON.stringify({ message: { id: "wamid.kapso5", from: "15005550007", text: { body: "Hi" } } });
    const signature = sign(rawBody);

    const first = await request(app).post(ROUTE_PATH).set("Content-Type", "application/json").set("X-Webhook-Signature", signature).send(rawBody);
    const second = await request(app).post(ROUTE_PATH).set("Content-Type", "application/json").set("X-Webhook-Signature", signature).send(rawBody);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(messagingClient.sendInteractiveButtons).toHaveBeenCalledTimes(1);
  });

  it("persists an interactive button-reply language selection, then sends the confirmation and a native interactive main menu", async () => {
    const from = "15005550008";
    const firstBody = JSON.stringify({ message: { id: "wamid.kapso6", from, text: { body: "Hi" } } });
    await request(app).post(ROUTE_PATH).set("Content-Type", "application/json").set("X-Webhook-Signature", sign(firstBody)).send(firstBody);
    messagingClient.sendInteractiveButtons!.mockClear();

    const selectionBody = JSON.stringify({
      message: { id: "wamid.kapso7", from, type: "interactive", interactive: { button_reply: { id: "language:en", title: "English" } } },
    });
    const response = await request(app)
      .post(ROUTE_PATH)
      .set("Content-Type", "application/json")
      .set("X-Webhook-Signature", sign(selectionBody))
      .send(selectionBody);

    expect(response.status).toBe(200);
    expect(messagingClient.sendText).toHaveBeenCalledWith({ from: FROM_NUMBER, to: from, body: "✓ English selected." });
    expect(messagingClient.sendInteractiveList).toHaveBeenCalledWith({
      from: FROM_NUMBER,
      to: from,
      bodyText: expect.any(String),
      buttonText: expect.any(String),
      sections: [{ rows: expect.arrayContaining([{ id: "menu:file-case", title: expect.any(String) }]) }],
    });
    expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();
  });

  it("never logs the webhook secret, signature, message body, or media id", async () => {
    const rawBody = JSON.stringify({
      message: { id: "wamid.kapso8", from: "15005550009", text: { body: "this is a secret complaint detail" } },
    });
    const signature = sign(rawBody);

    await request(app).post(ROUTE_PATH).set("Content-Type", "application/json").set("X-Webhook-Signature", signature).send(rawBody);

    const loggedOutput = logSpy.mock.calls.map((call: unknown[]) => call.join(" ")).join("\n");

    expect(loggedOutput).not.toContain(WEBHOOK_SECRET);
    expect(loggedOutput).not.toContain(signature);
    expect(loggedOutput).not.toContain("secret complaint detail");
  });

  it("is not mounted at all when no deps are injected and KAPSO_SPIKE_ENABLED is not set — default-off", async () => {
    expect(env.KAPSO_SPIKE_ENABLED).toBe(false);
    const defaultApp = createApp();
    const rawBody = JSON.stringify({ message: { id: "wamid.kapso9", from: "15005550006", text: { body: "Hi" } } });

    const response = await request(defaultApp)
      .post(ROUTE_PATH)
      .set("Content-Type", "application/json")
      .set("X-Webhook-Signature", sign(rawBody))
      .send(rawBody);

    expect(response.status).toBe(404);
  });
});
