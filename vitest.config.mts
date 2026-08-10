import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      TWILIO_ACCOUNT_SID: "ACtest00000000000000000000000000",
      TWILIO_AUTH_TOKEN: "test-auth-token",
      TWILIO_WHATSAPP_FROM: "whatsapp:+15005550006",
      PUBLIC_BASE_URL: "https://example.test",
    },
  },
});
