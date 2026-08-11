import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { getExpectedTwilioSignature } from "twilio";
import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { InMemoryConversationRepository } from "../src/repositories/in-memory/conversation-repository";
import { InMemoryProcessedWebhookRepository } from "../src/repositories/in-memory/processed-webhook-repository";
import { InMemoryFilingRepository } from "../src/repositories/in-memory/filing-repository";
import { createInMemoryWithTransaction } from "../src/repositories/in-memory/transaction";
import type { ProcessedWebhookRepository } from "../src/repositories/processed-webhook-repository";
import { createFakeMessagingClient, type FakeMessagingClient } from "./helpers/fake-messaging-client";

const ROUTE_PATH = "/webhooks/twilio/whatsapp";
const WEBHOOK_URL = `${env.PUBLIC_BASE_URL}${ROUTE_PATH}`;
const MAIN_MENU_CONTENT_SID = { en: env.TWILIO_MAIN_MENU_CONTENT_SID_EN, ml: env.TWILIO_MAIN_MENU_CONTENT_SID_ML };
const DRAFT_CHOICE_CONTENT_SID = { en: env.TWILIO_FILING_DRAFT_CHOICE_SID_EN, ml: env.TWILIO_FILING_DRAFT_CHOICE_SID_ML };
const NOTICE_CONTENT_SID = { en: env.TWILIO_FILING_NOTICE_SID_EN, ml: env.TWILIO_FILING_NOTICE_SID_ML };

function sign(params: Record<string, string>): string {
  return getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN, WEBHOOK_URL, params);
}

function findLoggedEvent(logSpy: ReturnType<typeof vi.spyOn>, messageSid: string): Record<string, unknown> {
  const loggedLine = logSpy.mock.calls
    .map((call: unknown[]) => call[0])
    .find((line: unknown): line is string => typeof line === "string" && line.includes(messageSid));

  expect(loggedLine).toBeDefined();
  return JSON.parse(loggedLine as string);
}

function buildDeps(
  conversationRepo: InMemoryConversationRepository,
  processedWebhookRepo: ProcessedWebhookRepository,
  messagingClient: FakeMessagingClient,
) {
  const mainMenuSenderDeps = { messagingClient, fromNumber: env.TWILIO_WHATSAPP_FROM, contentSidByLanguage: MAIN_MENU_CONTENT_SID };
  return {
    conversationRepo,
    processedWebhookRepo,
    languageWorkflowDeps: {
      conversationRepo,
      messagingClient,
      fromNumber: env.TWILIO_WHATSAPP_FROM,
      contentSid: env.TWILIO_LANGUAGE_CONTENT_SID,
      mainMenuContentSid: MAIN_MENU_CONTENT_SID,
    },
    mainMenuSenderDeps,
    filingWorkflowDeps: {
      conversationRepo,
      filingRepo: new InMemoryFilingRepository(conversationRepo),
      filingSenderDeps: {
        messagingClient,
        fromNumber: env.TWILIO_WHATSAPP_FROM,
        draftChoiceContentSid: DRAFT_CHOICE_CONTENT_SID,
        noticeContentSid: NOTICE_CONTENT_SID,
      },
      mainMenuSenderDeps,
      withTransaction: createInMemoryWithTransaction(),
    },
  };
}

describe("POST /webhooks/twilio/whatsapp", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let messagingClient: FakeMessagingClient;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    messagingClient = createFakeMessagingClient();
    app = createApp({
      twilioWebhookDeps: buildDeps(new InMemoryConversationRepository(), new InMemoryProcessedWebhookRepository(), messagingClient),
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("accepts a validly signed text message, returns empty TwiML, and opens the language picker", async () => {
    const params = {
      MessageSid: "SM1111111111111111111111111111111",
      From: "whatsapp:+15005550006",
      To: "whatsapp:+14155238886",
      WaId: "15005550006",
      ProfileName: "Test User",
      Body: "Hi",
      NumMedia: "0",
    };

    const response = await request(app)
      .post(ROUTE_PATH)
      .type("form")
      .set("X-Twilio-Signature", sign(params))
      .send(params);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/application\/xml/);
    expect(response.text).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

    const logged = findLoggedEvent(logSpy, params.MessageSid);
    expect(logged).toMatchObject({ status: 200, outcome: "accepted", mediaCount: 0 });

    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith({
      from: env.TWILIO_WHATSAPP_FROM,
      to: "whatsapp:+15005550006",
      contentSid: env.TWILIO_LANGUAGE_CONTENT_SID,
    });
  });

  it("accepts a validly signed media message", async () => {
    const params = {
      MessageSid: "SM2222222222222222222222222222222",
      From: "whatsapp:+15005550006",
      To: "whatsapp:+14155238886",
      Body: "",
      NumMedia: "1",
      MediaUrl0: "https://api.twilio.com/media/one",
      MediaContentType0: "image/jpeg",
    };

    const response = await request(app)
      .post(ROUTE_PATH)
      .type("form")
      .set("X-Twilio-Signature", sign(params))
      .send(params);

    expect(response.status).toBe(200);

    const logged = findLoggedEvent(logSpy, params.MessageSid);
    expect(logged).toMatchObject({ status: 200, outcome: "accepted", mediaCount: 1 });
  });

  it("opens the language picker for a first media-only message too", async () => {
    const params = {
      MessageSid: "SM9999999999999999999999999999999",
      From: "whatsapp:+15005550009",
      To: "whatsapp:+14155238886",
      Body: "",
      NumMedia: "1",
      MediaUrl0: "https://api.twilio.com/media/one",
      MediaContentType0: "image/jpeg",
    };

    const response = await request(app)
      .post(ROUTE_PATH)
      .type("form")
      .set("X-Twilio-Signature", sign(params))
      .send(params);

    expect(response.status).toBe(200);
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith({
      from: env.TWILIO_WHATSAPP_FROM,
      to: "whatsapp:+15005550009",
      contentSid: env.TWILIO_LANGUAGE_CONTENT_SID,
    });
  });

  it("rejects a request with an invalid signature", async () => {
    const params = {
      MessageSid: "SM3333333333333333333333333333333",
      From: "whatsapp:+15005550006",
      To: "whatsapp:+14155238886",
      Body: "Hi",
      NumMedia: "0",
    };

    const response = await request(app)
      .post(ROUTE_PATH)
      .type("form")
      .set("X-Twilio-Signature", "definitely-not-valid")
      .send(params);

    expect(response.status).toBe(403);
    expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();
  });

  it("rejects a non-form-encoded request with 403 instead of crashing", async () => {
    const response = await request(app)
      .post(ROUTE_PATH)
      .set("Content-Type", "application/json")
      .set("X-Twilio-Signature", "whatever")
      .send({ Body: "hi" });

    expect(response.status).toBe(403);
  });

  it("rejects a request with a missing signature", async () => {
    const params = {
      MessageSid: "SM4444444444444444444444444444444",
      From: "whatsapp:+15005550006",
      To: "whatsapp:+14155238886",
      Body: "Hi",
      NumMedia: "0",
    };

    const response = await request(app).post(ROUTE_PATH).type("form").send(params);

    expect(response.status).toBe(403);
  });

  it("never logs the auth token, signature, message body, or media URL", async () => {
    const params = {
      MessageSid: "SM5555555555555555555555555555555",
      From: "whatsapp:+15005550006",
      To: "whatsapp:+14155238886",
      Body: "this is a secret complaint detail",
      NumMedia: "1",
      MediaUrl0: "https://api.twilio.com/media/super-secret-evidence",
      MediaContentType0: "image/jpeg",
    };
    const signature = sign(params);

    await request(app).post(ROUTE_PATH).type("form").set("X-Twilio-Signature", signature).send(params);

    const loggedOutput = logSpy.mock.calls.map((call: unknown[]) => call.join(" ")).join("\n");

    expect(loggedOutput).not.toContain(env.TWILIO_AUTH_TOKEN);
    expect(loggedOutput).not.toContain(signature);
    expect(loggedOutput).not.toContain(params.Body);
    expect(loggedOutput).not.toContain(params.MediaUrl0);
  });

  it("does not send a second message for a duplicate MessageSid", async () => {
    const params = {
      MessageSid: "SM6666666666666666666666666666666",
      From: "whatsapp:+15005550007",
      To: "whatsapp:+14155238886",
      Body: "Hi",
      NumMedia: "0",
    };
    const signature = sign(params);

    const first = await request(app).post(ROUTE_PATH).type("form").set("X-Twilio-Signature", signature).send(params);
    const second = await request(app).post(ROUTE_PATH).type("form").set("X-Twilio-Signature", signature).send(params);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledTimes(1);
  });

  it("persists a Quick Reply button selection, sends the localized confirmation, then the main menu", async () => {
    const from = "whatsapp:+15005550008";
    const firstParams = {
      MessageSid: "SM7777777777777777777777777777777",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "Hi",
      NumMedia: "0",
    };
    await request(app).post(ROUTE_PATH).type("form").set("X-Twilio-Signature", sign(firstParams)).send(firstParams);
    messagingClient.sendContentTemplate.mockClear();

    const selectionParams = {
      MessageSid: "SM8888888888888888888888888888888",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "English",
      ButtonPayload: "language:en",
      ButtonText: "English",
      NumMedia: "0",
    };
    const response = await request(app)
      .post(ROUTE_PATH)
      .type("form")
      .set("X-Twilio-Signature", sign(selectionParams))
      .send(selectionParams);

    expect(response.status).toBe(200);
    expect(messagingClient.sendText).toHaveBeenCalledWith({
      from: env.TWILIO_WHATSAPP_FROM,
      to: from,
      body: "✓ English selected.",
    });
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith({
      from: env.TWILIO_WHATSAPP_FROM,
      to: from,
      contentSid: env.TWILIO_MAIN_MENU_CONTENT_SID_EN,
    });
  });

  it("routes a full conversation from Hi through a created filing draft, end to end (#8's no-draft flow)", async () => {
    const from = "whatsapp:+15005550011";
    const send = (params: Record<string, string>) =>
      request(app).post(ROUTE_PATH).type("form").set("X-Twilio-Signature", sign(params)).send(params);

    await send({ MessageSid: "SMflowa000000000000000000000000001", From: from, To: "whatsapp:+14155238886", Body: "Hi", NumMedia: "0" });
    await send({
      MessageSid: "SMflowa000000000000000000000000002",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "English",
      ButtonPayload: "language:en",
      NumMedia: "0",
    });

    const noticeResponse = await send({
      MessageSid: "SMflowa000000000000000000000000003",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "File or resume case",
      ButtonPayload: "menu:file-case",
      NumMedia: "0",
    });

    expect(noticeResponse.status).toBe(200);
    expect(messagingClient.sendContentTemplate).toHaveBeenCalledWith({
      from: env.TWILIO_WHATSAPP_FROM,
      to: from,
      contentSid: env.TWILIO_FILING_NOTICE_SID_EN,
    });

    const acceptResponse = await send({
      MessageSid: "SMflowa000000000000000000000000004",
      From: from,
      To: "whatsapp:+14155238886",
      Body: "Continue",
      ButtonPayload: "filing:accept-test-notice",
      NumMedia: "0",
    });

    expect(acceptResponse.status).toBe(200);
    expect(messagingClient.sendText).toHaveBeenCalledWith({
      from: env.TWILIO_WHATSAPP_FROM,
      to: from,
      body: expect.stringContaining("Your filing draft is ready"),
    });
  });

  it("acks with 200 and logs safely instead of a 500 when the idempotency claim itself fails (e.g. DB unreachable)", async () => {
    const errorLogSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const brokenProcessedWebhookRepo = {
      tryClaim: vi.fn().mockRejectedValue(new Error("connection refused")),
      markOutcome: vi.fn(),
    };
    const brokenApp = createApp({
      twilioWebhookDeps: buildDeps(new InMemoryConversationRepository(), brokenProcessedWebhookRepo, messagingClient),
    });

    const params = {
      MessageSid: "SM0000000000000000000000000000001",
      From: "whatsapp:+15005550010",
      To: "whatsapp:+14155238886",
      Body: "Hi",
      NumMedia: "0",
    };

    const response = await request(brokenApp)
      .post(ROUTE_PATH)
      .type("form")
      .set("X-Twilio-Signature", sign(params))
      .send(params);

    expect(response.status).toBe(200);
    expect(response.text).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    // No side effects ran — the claim itself failed before anything else did.
    expect(messagingClient.sendContentTemplate).not.toHaveBeenCalled();
    expect(brokenProcessedWebhookRepo.markOutcome).not.toHaveBeenCalled();

    const errorOutput = errorLogSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(errorOutput).toContain("processed_webhook_claim_failed");
    expect(errorOutput).not.toContain("connection refused");

    errorLogSpy.mockRestore();
  });
});
