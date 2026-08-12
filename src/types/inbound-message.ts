/**
 * Provider-neutral shape for an inbound chat message, independent of the
 * messaging vendor (Twilio today, a different provider later). Provider
 * adapters are responsible for translating their own payload into this
 * contract.
 */
export interface InboundMedia {
  url: string;
  contentType: string;
  index: number;
}

export interface InboundMessage {
  /** "kapso" is reserved for the issue #16 spike adapter — not yet a live sender. */
  provider: "twilio" | "kapso";
  messageId: string;
  channel: "whatsapp";
  from: string;
  to: string;
  userId?: string;
  profileName?: string;
  text: string;
  media: InboundMedia[];
  receivedAt: string;
}
