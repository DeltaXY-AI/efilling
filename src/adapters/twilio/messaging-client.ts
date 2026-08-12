import Twilio from "twilio";
import type { MessagingClient, SendResult } from "../../types/messaging-client";

/**
 * Thin wrapper around the Twilio REST client for outbound WhatsApp sends,
 * implementing the provider-neutral MessagingClient contract so the
 * language workflow can depend on an interface instead of the SDK directly
 * and tests can inject a fake instead of calling Twilio. Does not implement
 * sendInteractiveButtons/sendInteractiveList — Twilio represents an
 * interactive message as a pre-approved Content Template, already covered
 * by sendContentTemplate (see types/messaging-client.ts).
 */
export function createTwilioMessagingClient(accountSid: string, authToken: string): MessagingClient {
  const client = Twilio(accountSid, authToken);

  return {
    async sendContentTemplate({ from, to, contentSid }): Promise<SendResult> {
      // contentSid and body/mediaUrl are mutually exclusive on Twilio's API.
      const message = await client.messages.create({ from, to, contentSid });
      return { providerMessageId: message.sid };
    },
    async sendText({ from, to, body }): Promise<SendResult> {
      const message = await client.messages.create({ from, to, body });
      return { providerMessageId: message.sid };
    },
  };
}
