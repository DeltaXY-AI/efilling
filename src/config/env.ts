import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  // .trim() guards against trailing whitespace/newlines commonly left behind
  // when pasting values into a dashboard (e.g. Vercel's env var UI) — an
  // untrimmed PUBLIC_BASE_URL or TWILIO_AUTH_TOKEN silently breaks Twilio
  // signature comparison since it's an exact-string match.
  TWILIO_ACCOUNT_SID: z.string().trim().min(1, "TWILIO_ACCOUNT_SID is required"),
  TWILIO_AUTH_TOKEN: z.string().trim().min(1, "TWILIO_AUTH_TOKEN is required"),
  TWILIO_WHATSAPP_FROM: z.string().trim().min(1, "TWILIO_WHATSAPP_FROM is required"),
  PUBLIC_BASE_URL: z.string().trim().url("PUBLIC_BASE_URL must be an absolute URL"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }

  return parsed.data;
}

export const env = loadEnv();
