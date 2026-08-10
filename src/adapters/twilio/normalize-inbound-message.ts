import type { InboundMedia, InboundMessage } from "../../types/inbound-message";

/**
 * Shape of the fields Twilio posts for an inbound WhatsApp message. Twilio
 * sends every field as a string and indexes media with a numeric suffix
 * (`MediaUrl0`, `MediaContentType0`, `MediaUrl1`, ...).
 */
export interface TwilioWebhookBody {
  MessageSid?: string;
  From?: string;
  To?: string;
  WaId?: string;
  ProfileName?: string;
  Body?: string;
  NumMedia?: string;
  [field: string]: unknown;
}

function parseMedia(body: TwilioWebhookBody): InboundMedia[] {
  const numMedia = Number.parseInt(body.NumMedia ?? "0", 10);

  if (!Number.isFinite(numMedia) || numMedia <= 0) {
    return [];
  }

  const media: InboundMedia[] = [];

  for (let index = 0; index < numMedia; index += 1) {
    const url = body[`MediaUrl${index}`];

    if (typeof url !== "string" || url.length === 0) {
      continue;
    }

    const contentType = body[`MediaContentType${index}`];

    media.push({
      url,
      contentType: typeof contentType === "string" && contentType.length > 0
        ? contentType
        : "application/octet-stream",
      index,
    });
  }

  return media;
}

/**
 * Translates a Twilio WhatsApp webhook payload into the provider-neutral
 * inbound-message contract shared by the rest of the application.
 */
export function normalizeInboundMessage(body: TwilioWebhookBody): InboundMessage {
  return {
    provider: "twilio",
    messageId: body.MessageSid ?? "",
    channel: "whatsapp",
    from: body.From ?? "",
    to: body.To ?? "",
    userId: body.WaId || undefined,
    profileName: body.ProfileName || undefined,
    text: body.Body ?? "",
    media: parseMedia(body),
    receivedAt: new Date().toISOString(),
  };
}
