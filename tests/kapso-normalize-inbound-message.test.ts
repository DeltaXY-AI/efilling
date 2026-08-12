import { describe, expect, it } from "vitest";
import { extractKapsoSelection, normalizeKapsoInboundMessage } from "../src/adapters/kapso/normalize-inbound-message";

describe("normalizeKapsoInboundMessage", () => {
  it("normalizes a text-only message", () => {
    const message = normalizeKapsoInboundMessage({
      message: {
        id: "wamid.text1",
        from: "16315551181",
        type: "text",
        text: { body: "Hi" },
        timestamp: "1700000000",
      },
      conversation: { id: "conv_1" },
    });

    expect(message).toEqual({
      provider: "kapso",
      messageId: "wamid.text1",
      channel: "whatsapp",
      from: "16315551181",
      to: "",
      text: "Hi",
      media: [],
      receivedAt: new Date(1700000000 * 1000).toISOString(),
    });
  });

  it("falls back to the current time when timestamp is absent", () => {
    const before = Date.now();
    const message = normalizeKapsoInboundMessage({ message: { id: "wamid.no-ts", from: "16315551181", text: { body: "Hi" } } });
    const receivedAt = new Date(message.receivedAt).getTime();
    expect(receivedAt).toBeGreaterThanOrEqual(before);
  });

  it("normalizes media as a mediaId, never a url — Kapso/Meta only gives an id here", () => {
    const message = normalizeKapsoInboundMessage({
      message: {
        id: "wamid.media1",
        from: "16315551181",
        type: "image",
        image: { id: "media-abc123", mime_type: "image/jpeg" },
      },
    });

    expect(message.media).toEqual([{ mediaId: "media-abc123", contentType: "image/jpeg", index: 0 }]);
    expect(message.media[0].url).toBeUndefined();
  });

  it("collects multiple media fields present on the same message in a stable order", () => {
    const message = normalizeKapsoInboundMessage({
      message: {
        id: "wamid.media2",
        from: "16315551181",
        image: { id: "media-image" },
        document: { id: "media-doc", mime_type: "application/pdf" },
      },
    });

    expect(message.media).toEqual([
      { mediaId: "media-image", contentType: "application/octet-stream", index: 0 },
      { mediaId: "media-doc", contentType: "application/pdf", index: 1 },
    ]);
  });

  it("handles a missing message object without throwing", () => {
    const message = normalizeKapsoInboundMessage({});
    expect(message.messageId).toBe("");
    expect(message.from).toBe("");
    expect(message.text).toBe("");
    expect(message.media).toEqual([]);
  });
});

describe("extractKapsoSelection", () => {
  it("extracts a button reply", () => {
    expect(extractKapsoSelection({ interactive: { button_reply: { id: "language:en", title: "English" } } })).toEqual({
      buttonPayload: "language:en",
      buttonText: "English",
      listId: undefined,
      listTitle: undefined,
    });
  });

  it("extracts a list reply", () => {
    expect(extractKapsoSelection({ interactive: { list_reply: { id: "menu:file-case", title: "File a case" } } })).toEqual({
      buttonPayload: undefined,
      buttonText: undefined,
      listId: "menu:file-case",
      listTitle: "File a case",
    });
  });

  it("returns all-undefined for a plain text message", () => {
    expect(extractKapsoSelection({ text: { body: "Hi" } })).toEqual({
      buttonPayload: undefined,
      buttonText: undefined,
      listId: undefined,
      listTitle: undefined,
    });
  });
});
