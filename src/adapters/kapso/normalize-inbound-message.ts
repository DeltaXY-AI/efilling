import type { InboundMedia, InboundMessage } from "../../types/inbound-message";

interface KapsoInteractiveReply {
  id?: string;
  title?: string;
}

interface KapsoMediaField {
  id?: string;
  mime_type?: string;
}

export interface KapsoWebhookMessage {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  interactive?: {
    button_reply?: KapsoInteractiveReply;
    list_reply?: KapsoInteractiveReply;
  };
  timestamp?: string;
  image?: KapsoMediaField;
  document?: KapsoMediaField;
  video?: KapsoMediaField;
  audio?: KapsoMediaField;
}

export interface KapsoWebhookConversation {
  id?: string;
  phone_number?: string;
  business_scoped_user_id?: string;
}

/** Shape of a `whatsapp.message.received` Kapso webhook payload. */
export interface KapsoWebhookBody {
  message?: KapsoWebhookMessage;
  conversation?: KapsoWebhookConversation;
}

const MEDIA_FIELDS = ["image", "document", "video", "audio"] as const;

function parseMedia(message: KapsoWebhookMessage): InboundMedia[] {
  const media: InboundMedia[] = [];

  for (const field of MEDIA_FIELDS) {
    const item = message[field];
    if (item?.id) {
      media.push({
        mediaId: item.id,
        contentType: item.mime_type ?? "application/octet-stream",
        index: media.length,
      });
    }
  }

  return media;
}

/**
 * Translates a Kapso `whatsapp.message.received` webhook payload into the
 * provider-neutral inbound-message contract.
 *
 * Two open items, deliberately not guessed at here and flagged for the Part
 * C spike run (issue #16) to confirm against a real payload rather than
 * fabricated certainty:
 *  - `to`: Kapso's documented payload fields don't obviously carry the
 *    receiving business number; callers already know it via
 *    KAPSO_PHONE_NUMBER_ID, so this is left empty rather than guessed.
 *  - Identity format: Kapso's `message.from` is bare digits (e.g.
 *    "16315551181"), unlike Twilio's "whatsapp:+1..." — normalizeWhatsappNumber
 *    does not reconcile the two formats, so the same physical phone number
 *    reaching the app through both providers would currently create two
 *    separate conversation rows. Worth resolving before any real cutover,
 *    not before then.
 */
export function normalizeKapsoInboundMessage(body: KapsoWebhookBody): InboundMessage {
  const message = body.message ?? {};

  return {
    provider: "kapso",
    messageId: message.id ?? "",
    channel: "whatsapp",
    from: message.from ?? "",
    to: "",
    text: message.text?.body ?? "",
    media: parseMedia(message),
    receivedAt: message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : new Date().toISOString(),
  };
}

export interface KapsoSelection {
  buttonPayload?: string;
  buttonText?: string;
  listId?: string;
  listTitle?: string;
}

/** Extracts the stable button/list selection id+title from an interactive reply, if present. */
export function extractKapsoSelection(message: KapsoWebhookMessage): KapsoSelection {
  const buttonReply = message.interactive?.button_reply;
  const listReply = message.interactive?.list_reply;

  return {
    buttonPayload: buttonReply?.id,
    buttonText: buttonReply?.title,
    listId: listReply?.id,
    listTitle: listReply?.title,
  };
}
