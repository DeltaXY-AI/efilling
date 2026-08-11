import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  diffTemplates,
  getContentTemplate,
  loadTwilioCredentialsFromEnv,
  templatesMatch,
  type ContentTemplateSpec,
} from "./content-api-client";

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

// Only auto-run when executed directly (`tsx verify-language-template.ts` /
// `npm run twilio:template:verify`) — not when imported by tests.
if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error("✗ Failed to verify Twilio Content Template");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
