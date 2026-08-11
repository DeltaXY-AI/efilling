import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      TWILIO_ACCOUNT_SID: "ACtest00000000000000000000000000",
      TWILIO_AUTH_TOKEN: "test-auth-token",
      TWILIO_WHATSAPP_FROM: "whatsapp:+15005550006",
      TWILIO_LANGUAGE_CONTENT_SID: "HXtest00000000000000000000000000",
      PUBLIC_BASE_URL: "https://example.test",
      // Never actually connected to in tests — routes are exercised via
      // createApp({ twilioWebhookDeps }) with in-memory repositories, but
      // env.ts validates this eagerly on import regardless.
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
    },
  },
});
