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

  it("sendText posts to Kapso's Meta-passthrough endpoint and returns the provider message id", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: "wamid.sent1" }] }), { status: 200 }));
    const client = createKapsoMessagingClient(API_KEY, PHONE_NUMBER_ID);

    const result = await client.sendText({ from: "ignored-by-kapso", to: "15551234567", body: "Hello" });

    expect(result).toEqual({ providerMessageId: "wamid.sent1" });
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

  it("sendText throws rather than returning an unusable result when Kapso's 2xx response has no message id", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ messaging_product: "whatsapp" }), { status: 200 }));
    const client = createKapsoMessagingClient(API_KEY, PHONE_NUMBER_ID);

    await expect(client.sendText({ from: "x", to: "15551234567", body: "Hi" })).rejects.toThrow(/no message id/);
  });

  it("sendInteractiveButtons posts a Meta-shaped interactive button message and returns the message id", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.buttons1" }] }), { status: 200 }));
    const client = createKapsoMessagingClient(API_KEY, PHONE_NUMBER_ID);

    const result = await client.sendInteractiveButtons!({
      from: "ignored",
      to: "15551234567",
      bodyText: "Pick one",
      buttons: [
        { id: "language:en", title: "English" },
        { id: "language:ml", title: "മലയാളം" },
      ],
    });

    expect(result).toEqual({ providerMessageId: "wamid.buttons1" });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: "whatsapp",
      to: "15551234567",
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Pick one" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "language:en", title: "English" } },
            { type: "reply", reply: { id: "language:ml", title: "മലയാളം" } },
          ],
        },
      },
    });
  });

  it("sendInteractiveButtons rejects more than Meta's 3-button limit without calling fetch", async () => {
    const client = createKapsoMessagingClient(API_KEY, PHONE_NUMBER_ID);
    const buttons = [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
      { id: "c", title: "C" },
      { id: "d", title: "D" },
    ];

    await expect(client.sendInteractiveButtons!({ from: "x", to: "15551234567", bodyText: "Pick", buttons })).rejects.toThrow(/1-3 buttons/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sendInteractiveList posts a Meta-shaped interactive list message and returns the message id", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.list1" }] }), { status: 200 }));
    const client = createKapsoMessagingClient(API_KEY, PHONE_NUMBER_ID);

    const result = await client.sendInteractiveList!({
      from: "ignored",
      to: "15551234567",
      bodyText: "What would you like to do?",
      buttonText: "Choose",
      sections: [{ rows: [{ id: "menu:file-case", title: "File or resume case" }] }],
    });

    expect(result).toEqual({ providerMessageId: "wamid.list1" });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: "whatsapp",
      to: "15551234567",
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: "What would you like to do?" },
        action: {
          button: "Choose",
          sections: [{ title: undefined, rows: [{ id: "menu:file-case", title: "File or resume case", description: undefined }] }],
        },
      },
    });
  });

  it("sendInteractiveList rejects more than Meta's 10-row limit without calling fetch", async () => {
    const client = createKapsoMessagingClient(API_KEY, PHONE_NUMBER_ID);
    const rows = Array.from({ length: 11 }, (_, index) => ({ id: `opt${index}`, title: `Option ${index}` }));

    await expect(client.sendInteractiveList!({ from: "x", to: "15551234567", bodyText: "Pick", buttonText: "Go", sections: [{ rows }] })).rejects.toThrow(
      /1-10 rows/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
