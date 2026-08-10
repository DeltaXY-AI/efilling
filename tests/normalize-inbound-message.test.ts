import { describe, expect, it } from "vitest";
import { normalizeInboundMessage } from "../src/adapters/twilio/normalize-inbound-message";

describe("normalizeInboundMessage", () => {
  it("normalizes a text-only message", () => {
    const message = normalizeInboundMessage({
      MessageSid: "SM1111111111111111111111111111111",
      From: "whatsapp:+15005550006",
      To: "whatsapp:+14155238886",
      WaId: "15005550006",
      ProfileName: "Test User",
      Body: "Hi",
      NumMedia: "0",
    });

    expect(message).toEqual({
      provider: "twilio",
      messageId: "SM1111111111111111111111111111111",
      channel: "whatsapp",
      from: "whatsapp:+15005550006",
      to: "whatsapp:+14155238886",
      userId: "15005550006",
      profileName: "Test User",
      text: "Hi",
      media: [],
      receivedAt: message.receivedAt,
    });
    expect(new Date(message.receivedAt).toISOString()).toBe(message.receivedAt);
  });

  it("normalizes media metadata for a media message", () => {
    const message = normalizeInboundMessage({
      MessageSid: "SM2222222222222222222222222222222",
      From: "whatsapp:+15005550006",
      To: "whatsapp:+14155238886",
      Body: "",
      NumMedia: "2",
      MediaUrl0: "https://api.twilio.com/media/one",
      MediaContentType0: "image/jpeg",
      MediaUrl1: "https://api.twilio.com/media/two",
      MediaContentType1: "application/pdf",
    });

    expect(message.media).toEqual([
      { url: "https://api.twilio.com/media/one", contentType: "image/jpeg", index: 0 },
      { url: "https://api.twilio.com/media/two", contentType: "application/pdf", index: 1 },
    ]);
  });

  it("keeps an empty Body with media as a valid inbound event", () => {
    const message = normalizeInboundMessage({
      MessageSid: "SM3333333333333333333333333333333",
      From: "whatsapp:+15005550006",
      To: "whatsapp:+14155238886",
      Body: "",
      NumMedia: "1",
      MediaUrl0: "https://api.twilio.com/media/one",
      MediaContentType0: "image/png",
    });

    expect(message.text).toBe("");
    expect(message.media).toHaveLength(1);
  });

  it("omits userId and profileName when Twilio does not send them", () => {
    const message = normalizeInboundMessage({
      MessageSid: "SM4444444444444444444444444444444",
      From: "whatsapp:+15005550006",
      To: "whatsapp:+14155238886",
      Body: "Hi",
      NumMedia: "0",
    });

    expect(message.userId).toBeUndefined();
    expect(message.profileName).toBeUndefined();
  });
});
