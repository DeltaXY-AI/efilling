import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  getContentTemplate,
  loadTwilioCredentialsFromEnv,
  redactCredentials,
  type ContentTemplateSpec,
} from "./content-api-client";
import { diffTemplates, templatesMatch } from "./template-comparison";

const SPEC_PATH = join(__dirname, "..", "templates", "language-selection.json");

const envSchema = z.object({
  TWILIO_LANGUAGE_CONTENT_SID: z.string().trim().min(1, "TWILIO_LANGUAGE_CONTENT_SID is required"),
});

function loadSpec(): ContentTemplateSpec {
  return JSON.parse(readFileSync(SPEC_PATH, "utf8")) as ContentTemplateSpec;
}

export async function main(): Promise<void> {
  const credentials = loadTwilioCredentialsFromEnv();
  const parsedEnv = envSchema.safeParse(process.env);

  if (!parsedEnv.success) {
    console.error("✗ TWILIO_LANGUAGE_CONTENT_SID is not configured.");
    process.exitCode = 1;
    return;
  }

  const spec = loadSpec();
  const remote = await getContentTemplate(credentials, parsedEnv.data.TWILIO_LANGUAGE_CONTENT_SID);

  if (!remote) {
    console.error(`✗ No Twilio Content Template found for SID ${parsedEnv.data.TWILIO_LANGUAGE_CONTENT_SID}`);
    process.exitCode = 1;
    return;
  }

  if (!templatesMatch(spec, remote)) {
    console.error("✗ The remote Twilio Content Template does not match the repository specification.");
    console.error(`Content SID: ${remote.sid}`);
    console.error("Differences:");
    for (const line of diffTemplates(spec, remote)) {
      console.error(`  - ${line}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("✓ Twilio Content Template matches the repository specification");
  console.log(`Friendly name: ${spec.friendly_name}`);
  console.log(`Content SID: ${remote.sid}`);
  console.log("This script never submits templates for WhatsApp approval.");
}

/**
 * Runs `main()` and, if it throws, prints a redacted failure message and
 * sets a non-zero exit code. Exported separately from the auto-run guard
 * below so tests can exercise this exact failure path (including the
 * redaction) without relying on `process.argv`.
 */
export async function run(): Promise<void> {
  try {
    await main();
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    // Defense-in-depth: redact the configured credentials from whatever
    // reaches this catch, even if it didn't come from a Twilio Content API
    // response (which is already redacted at the source).
    try {
      message = redactCredentials(message, loadTwilioCredentialsFromEnv());
    } catch {
      // Credentials themselves aren't available — nothing to redact.
    }
    console.error("✗ Failed to verify Twilio Content Template");
    console.error(message);
    process.exitCode = 1;
  }
}

// Only auto-run when executed directly (`tsx verify-language-template.ts` /
// `npm run twilio:template:verify`) — not when imported by tests.
if (process.argv[1] === __filename) {
  void run();
}
