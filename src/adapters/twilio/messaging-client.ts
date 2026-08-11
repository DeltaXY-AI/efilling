import Twilio from "twilio";

/**
 * Thin wrapper around the Twilio REST client for outbound WhatsApp sends,
 * so the language workflow can depend on an interface instead of the SDK
 * directly and tests can inject a fake instead of calling Twilio.
 */
export interface TwilioMessagingClient {
  sendContentTemplate(input: {
    from: string;
    to: string;
    contentSid: string;
    /** Values for the template's `{{n}}` placeholders (#9's enrolment confirmation uses `{{1}}`). Omit entirely for templates with no variables. */
    contentVariables?: Record<string, string>;
  }): Promise<void>;
  sendText(input: { from: string; to: string; body: string }): Promise<void>;
}

export function createTwilioMessagingClient(accountSid: string, authToken: string): TwilioMessagingClient {
  const client = Twilio(accountSid, authToken);

  return {
    async sendContentTemplate({ from, to, contentSid, contentVariables }) {
      // contentSid and body/mediaUrl are mutually exclusive on Twilio's API.
      await client.messages.create({
        from,
        to,
        contentSid,
        ...(contentVariables ? { contentVariables: JSON.stringify(contentVariables) } : {}),
      });
    },
    async sendText({ from, to, body }) {
      await client.messages.create({ from, to, body });
    },
  };
}
