import type { InteractiveButton, InteractiveListSection, MessagingClient, SendResult } from "../../types/messaging-client";

const KAPSO_BASE_URL = "https://api.kapso.ai/meta/whatsapp";
const KAPSO_GRAPH_VERSION = "v24.0";
// Meta's real, documented WhatsApp Cloud API limits for interactive messages —
// enforced here rather than left to fail opaquely on Meta's side.
const MAX_INTERACTIVE_BUTTONS = 3;
const MAX_INTERACTIVE_LIST_ROWS = 10;

/**
 * Kapso has no equivalent to Twilio's Content Template SIDs — its
 * Meta-passthrough API sends templates by name/language/components, not by
 * an opaque provider-specific resource id. Per issue #16: "Existing Twilio
 * Content SIDs are Twilio resources and cannot be treated as migrated Meta
 * templates." Faking support here would be worse than not supporting it —
 * every sendContentTemplate call throws this instead, so callers fall back
 * to the existing plain-text path. Native interactive buttons/lists (below)
 * are the real migration target for the current in-session flows.
 */
export class KapsoTemplateSendUnsupportedError extends Error {
  constructor() {
    super("Kapso has no Content-Template-SID equivalent; use native interactive buttons/lists instead (issue #16, task 6).");
    this.name = "KapsoTemplateSendUnsupportedError";
  }
}

interface KapsoSendResponse {
  messages?: Array<{ id?: string }>;
}

/**
 * Thin wrapper around Kapso's Meta-passthrough REST API for outbound
 * WhatsApp sends, implementing the provider-neutral MessagingClient
 * contract. `phoneNumberId` identifies the sending number and is baked into
 * every request path, mirroring how Kapso's own SDK examples are shaped.
 */
export function createKapsoMessagingClient(apiKey: string, phoneNumberId: string): MessagingClient {
  async function post(body: Record<string, unknown>): Promise<SendResult> {
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

    const parsed = (await response.json()) as KapsoSendResponse;
    const providerMessageId = parsed.messages?.[0]?.id;

    if (!providerMessageId) {
      // A 2xx with no message id is not a state we can reconcile later
      // (issue #16 task 7 needs this id to match delivery-status webhooks
      // back to an outbound_messages row) — treat it as a failure rather
      // than silently returning an unusable result.
      throw new Error("Kapso send succeeded but returned no message id");
    }

    return { providerMessageId };
  }

  return {
    async sendContentTemplate() {
      throw new KapsoTemplateSendUnsupportedError();
    },
    sendText({ to, body }) {
      return post({ messaging_product: "whatsapp", to, type: "text", text: { body } });
    },
    async sendInteractiveButtons({ to, bodyText, buttons }: { to: string; from: string; bodyText: string; buttons: InteractiveButton[] }) {
      if (buttons.length === 0 || buttons.length > MAX_INTERACTIVE_BUTTONS) {
        throw new Error(`Kapso/Meta interactive button messages support 1-${MAX_INTERACTIVE_BUTTONS} buttons, got ${buttons.length}`);
      }

      return post({
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: bodyText },
          action: {
            buttons: buttons.map((button) => ({ type: "reply", reply: { id: button.id, title: button.title } })),
          },
        },
      });
    },
    async sendInteractiveList({
      to,
      bodyText,
      buttonText,
      sections,
    }: {
      to: string;
      from: string;
      bodyText: string;
      buttonText: string;
      sections: InteractiveListSection[];
    }) {
      const totalRows = sections.reduce((count, section) => count + section.rows.length, 0);
      if (totalRows === 0 || totalRows > MAX_INTERACTIVE_LIST_ROWS) {
        throw new Error(`Kapso/Meta interactive list messages support 1-${MAX_INTERACTIVE_LIST_ROWS} rows total, got ${totalRows}`);
      }

      return post({
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: bodyText },
          action: {
            button: buttonText,
            sections: sections.map((section) => ({
              title: section.title,
              rows: section.rows.map((row) => ({ id: row.id, title: row.title, description: row.description })),
            })),
          },
        },
      });
    },
  };
}
