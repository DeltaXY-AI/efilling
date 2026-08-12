import Twilio from "twilio";
import type { MessagingClient } from "../../types/messaging-client";

/**
 * Thin wrapper around the Twilio REST client for outbound WhatsApp sends,
 * implementing the provider-neutral MessagingClient contract so the
 * language workflow can depend on an interface instead of the SDK directly
 * and tests can inject a fake instead of calling Twilio.
 */
export function createTwilioMessagingClient(accountSid: string, authToken: string): MessagingClient {
  const client = Twilio(accountSid, authToken);

  return {
    async sendContentTemplate({ from, to, contentSid }) {
      // contentSid and body/mediaUrl are mutually exclusive on Twilio's API.
      await client.messages.create({ from, to, contentSid });
    },
    async sendText({ from, to, body }) {
      await client.messages.create({ from, to, body });
    },
  };
}
