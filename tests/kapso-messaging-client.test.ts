import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKapsoMessagingClient, KapsoTemplateSendUnsupportedError } from "../src/adapters/kapso/messaging-client";

const API_KEY = "test-kapso-api-key";
const PHONE_NUMBER_ID = "647015955153740";

describe("createKapsoMessagingClient", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("sendText posts to Kapso's Meta-passthrough endpoint with the API key header and text body", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }));
    const client = createKapsoMessagingClient(API_KEY, PHONE_NUMBER_ID);

    await client.sendText({ from: "ignored-by-kapso", to: "15551234567", body: "Hello" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.kapso.ai/meta/whatsapp/v24.0/${PHONE_NUMBER_ID}/messages`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe(API_KEY);
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: "whatsapp",
      to: "15551234567",
      type: "text",
      text: { body: "Hello" },
    });
  });

  it("sendText throws a safe error (no response body) on a non-2xx response", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ error: { message: "contains a real phone number: 15551234567" } }), { status: 400 }));
    const client = createKapsoMessagingClient(API_KEY, PHONE_NUMBER_ID);

    await expect(client.sendText({ from: "x", to: "15551234567", body: "Hi" })).rejects.toThrow("Kapso send failed with status 400");
    await expect(client.sendText({ from: "x", to: "15551234567", body: "Hi" })).rejects.not.toThrow(/15551234567/);
  });

  it("sendContentTemplate always throws — Kapso has no Content-Template-SID equivalent", async () => {
    const client = createKapsoMessagingClient(API_KEY, PHONE_NUMBER_ID);

    await expect(client.sendContentTemplate({ from: "x", to: "15551234567", contentSid: "anything" })).rejects.toBeInstanceOf(
      KapsoTemplateSendUnsupportedError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
