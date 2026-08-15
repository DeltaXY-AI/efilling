import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      TWILIO_ACCOUNT_SID: "ACtest00000000000000000000000000",
      TWILIO_AUTH_TOKEN: "test-auth-token",
      TWILIO_WHATSAPP_FROM: "whatsapp:+15005550006",
      TWILIO_LANGUAGE_CONTENT_SID: "HXtest00000000000000000000000000",
      TWILIO_MAIN_MENU_CONTENT_SID_EN: "HXtestmenuen0000000000000000000000",
      TWILIO_MAIN_MENU_CONTENT_SID_ML: "HXtestmenuml0000000000000000000000",
      TWILIO_FILING_DRAFT_CHOICE_SID_EN: "HXtestdraftchoiceen00000000000000",
      TWILIO_FILING_DRAFT_CHOICE_SID_ML: "HXtestdraftchoiceml00000000000000",
      TWILIO_FILING_NOTICE_SID_EN: "HXtestnoticeen000000000000000000",
      TWILIO_FILING_NOTICE_SID_ML: "HXtestnoticeml000000000000000000",
      TWILIO_ENROLMENT_PROMPT_SID_EN: "HXtestenrolpromptE0000000000000000",
      TWILIO_ENROLMENT_PROMPT_SID_ML: "HXtestenrolpromptM0000000000000000",
      TWILIO_ENROLMENT_CONFIRM_SID_EN: "HXtestenrolconfirmE000000000000000",
      TWILIO_ENROLMENT_CONFIRM_SID_ML: "HXtestenrolconfirmM000000000000000",
      TWILIO_COMPLAINANT_REVIEW_SID_EN: "HXtestcreviewe0000000000000000000",
      TWILIO_COMPLAINANT_REVIEW_SID_ML: "HXtestcreviewml0000000000000000000",
      TWILIO_COMPLAINANT_EDIT_FIELDS_SID_EN: "HXtestcedite0000000000000000000000",
      TWILIO_COMPLAINANT_EDIT_FIELDS_SID_ML: "HXtestceditml0000000000000000000000",
      TWILIO_ACCUSED_REVIEW_SID_EN: "HXtestareviewe000000000000000000000",
      TWILIO_ACCUSED_REVIEW_SID_ML: "HXtestareviewml000000000000000000000",
      TWILIO_ACCUSED_EDIT_FIELDS_SID_EN: "HXtestaedite00000000000000000000000",
      TWILIO_ACCUSED_EDIT_FIELDS_SID_ML: "HXtestaeditml00000000000000000000000",
      PUBLIC_BASE_URL: "https://example.test",
      // Never actually connected to in tests — routes are exercised via
      // createApp({ twilioWebhookDeps }) with in-memory repositories, but
      // env.ts validates this eagerly on import regardless.
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
      // Never actually uploaded to in tests — filing-document tests inject
      // a fake BlobStorage, but env.ts validates this eagerly on import.
      BLOB_READ_WRITE_TOKEN: "test-blob-token",
    },
  },
});
