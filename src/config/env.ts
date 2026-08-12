import { z } from "zod";

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  TWILIO_ACCOUNT_SID: z.string().min(1, "TWILIO_ACCOUNT_SID is required"),
  TWILIO_AUTH_TOKEN: z.string().min(1, "TWILIO_AUTH_TOKEN is required"),
  TWILIO_WHATSAPP_FROM: z.string().min(1, "TWILIO_WHATSAPP_FROM is required"),
  TWILIO_LANGUAGE_CONTENT_SID: z.string().min(1, "TWILIO_LANGUAGE_CONTENT_SID is required"),
  TWILIO_MAIN_MENU_CONTENT_SID_EN: z.string().min(1, "TWILIO_MAIN_MENU_CONTENT_SID_EN is required"),
  TWILIO_MAIN_MENU_CONTENT_SID_ML: z.string().min(1, "TWILIO_MAIN_MENU_CONTENT_SID_ML is required"),
  TWILIO_FILING_DRAFT_CHOICE_SID_EN: z.string().min(1, "TWILIO_FILING_DRAFT_CHOICE_SID_EN is required"),
  TWILIO_FILING_DRAFT_CHOICE_SID_ML: z.string().min(1, "TWILIO_FILING_DRAFT_CHOICE_SID_ML is required"),
  TWILIO_FILING_NOTICE_SID_EN: z.string().min(1, "TWILIO_FILING_NOTICE_SID_EN is required"),
  TWILIO_FILING_NOTICE_SID_ML: z.string().min(1, "TWILIO_FILING_NOTICE_SID_ML is required"),
  PUBLIC_BASE_URL: z.string().url("PUBLIC_BASE_URL must be an absolute URL"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // #16 Kapso migration spike — everything below is optional and defaults to
  // disabled, so an unmodified Production/.env with none of these vars set
  // behaves exactly as it did before this slice. Never required unless
  // KAPSO_SPIKE_ENABLED is explicitly "true" (see the cross-field check
  // below), and even then only on a non-production, isolated deployment —
  // this flag must never be turned on in Production per issue #16.
  KAPSO_SPIKE_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  KAPSO_API_KEY: z.string().optional(),
  KAPSO_PHONE_NUMBER_ID: z.string().optional(),
  KAPSO_WEBHOOK_SECRET: z.string().optional(),
});

const envSchema = baseEnvSchema.refine(
  (value) => !value.KAPSO_SPIKE_ENABLED || Boolean(value.KAPSO_API_KEY && value.KAPSO_PHONE_NUMBER_ID && value.KAPSO_WEBHOOK_SECRET),
  { message: "KAPSO_API_KEY, KAPSO_PHONE_NUMBER_ID, and KAPSO_WEBHOOK_SECRET are all required when KAPSO_SPIKE_ENABLED=true" },
);

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const flattened = parsed.error.flatten();
    console.error("Invalid environment variables:", flattened.fieldErrors, flattened.formErrors);
    throw new Error("Invalid environment variables");
  }

  return parsed.data;
}

export const env = loadEnv();
