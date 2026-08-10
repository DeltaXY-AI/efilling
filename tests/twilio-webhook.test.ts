import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { getExpectedTwilioSignature } from "twilio";
import app from "../src/index";
import { env } from "../src/config/env";

const ROUTE_PATH = "/webhooks/twilio/whatsapp";
const WEBHOOK_URL = `${env.PUBLIC_BASE_URL}${ROUTE_PATH}`;

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

describe("POST /webhooks/twilio/whatsapp", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("accepts a validly signed text message and returns empty TwiML", async () => {
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
});
