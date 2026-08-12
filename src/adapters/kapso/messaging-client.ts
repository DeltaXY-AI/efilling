import type { MessagingClient } from "../../types/messaging-client";

const KAPSO_BASE_URL = "https://api.kapso.ai/meta/whatsapp";
const KAPSO_GRAPH_VERSION = "v24.0";

/**
 * Kapso has no equivalent to Twilio's Content Template SIDs — its
 * Meta-passthrough API sends templates by name/language/components, not by
 * an opaque provider-specific resource id. Per issue #16: "Existing Twilio
 * Content SIDs are Twilio resources and cannot be treated as migrated Meta
 * templates." Faking support here would be worse than not supporting it —
 * every sendContentTemplate call throws this instead, so callers fall back
 * to the existing plain-text path unchanged. Task #16-6 replaces the actual
 * in-session sends with native Kapso interactive buttons/lists, which is
 * the real migration target for the current flows (not templates at all).
 */
export class KapsoTemplateSendUnsupportedError extends Error {
  constructor() {
    super("Kapso has no Content-Template-SID equivalent; use native interactive buttons/lists instead (issue #16, task 6).");
    this.name = "KapsoTemplateSendUnsupportedError";
  }
}

/**
 * Thin wrapper around Kapso's Meta-passthrough REST API for outbound
 * WhatsApp sends, implementing the same provider-neutral MessagingClient
 * contract as the Twilio adapter. `phoneNumberId` identifies the sending
 * number and is baked into every request path, mirroring how Kapso's own
 * SDK examples are shaped.
 */
export function createKapsoMessagingClient(apiKey: string, phoneNumberId: string): MessagingClient {
  async function post(body: Record<string, unknown>): Promise<void> {
    const response = await fetch(`${KAPSO_BASE_URL}/${KAPSO_GRAPH_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // Deliberately never include the response body in the thrown error —
      // Kapso/Meta error payloads can echo back recipient numbers or
      // message content, which must never end up in logs.
      throw new Error(`Kapso send failed with status ${response.status}`);
    }
  }

  return {
    async sendContentTemplate() {
      throw new KapsoTemplateSendUnsupportedError();
    },
    async sendText({ to, body }) {
      await post({ messaging_product: "whatsapp", to, type: "text", text: { body } });
    },
  };
}
