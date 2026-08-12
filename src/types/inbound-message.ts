/**
 * Provider-neutral shape for an inbound chat message, independent of the
 * messaging vendor (Twilio today, a different provider later). Provider
 * adapters are responsible for translating their own payload into this
 * contract.
 */
export interface InboundMedia {
  /** Directly usable download URL — always present for Twilio. */
  url?: string;
  /**
   * Provider's own media identifier, present instead of `url` for providers
   * that only hand back an id in the webhook payload (Kapso/Meta) — the
   * caller must resolve it to a URL via a separate follow-up call before
   * downloading. Deliberately not resolved inside normalization, which
   * stays synchronous and side-effect-free for every provider.
   */
  mediaId?: string;
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
