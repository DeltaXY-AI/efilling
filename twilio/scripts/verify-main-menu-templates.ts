import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { getContentTemplate, loadTwilioCredentialsFromEnv, redactCredentials, type ContentTemplateSpec } from "./content-api-client";
import { diffTemplates, templatesMatch } from "./template-comparison";

interface MenuTemplateEntry {
  label: string;
  fileName: string;
  envVar: string;
}

const MENU_TEMPLATES: MenuTemplateEntry[] = [
  { label: "English", fileName: "complainant-advocate-menu.en.json", envVar: "TWILIO_MAIN_MENU_CONTENT_SID_EN" },
  { label: "Malayalam", fileName: "complainant-advocate-menu.ml.json", envVar: "TWILIO_MAIN_MENU_CONTENT_SID_ML" },
];

const envSchema = z.object({
  TWILIO_MAIN_MENU_CONTENT_SID_EN: z.string().trim().min(1, "TWILIO_MAIN_MENU_CONTENT_SID_EN is required"),
  TWILIO_MAIN_MENU_CONTENT_SID_ML: z.string().trim().min(1, "TWILIO_MAIN_MENU_CONTENT_SID_ML is required"),
});

function loadSpec(fileName: string): ContentTemplateSpec {
  return JSON.parse(readFileSync(join(__dirname, "..", "templates", fileName), "utf8")) as ContentTemplateSpec;
}

/** Verifies both configured Content SIDs independently, reporting each result clearly. */
export async function main(): Promise<void> {
  const credentials = loadTwilioCredentialsFromEnv();
  const parsedEnv = envSchema.safeParse(process.env);

  if (!parsedEnv.success) {
    const missing = Object.keys(parsedEnv.error.flatten().fieldErrors).join(", ");
    console.error(`✗ Missing required environment variables: ${missing}`);
    process.exitCode = 1;
    return;
  }

  let anyFailed = false;

  for (const entry of MENU_TEMPLATES) {
    const spec = loadSpec(entry.fileName);
    const sid = parsedEnv.data[entry.envVar as keyof typeof parsedEnv.data];
    console.log(`--- ${entry.label} (${spec.friendly_name}) ---`);

    const remote = await getContentTemplate(credentials, sid);

    if (!remote) {
      anyFailed = true;
      console.error(`✗ No Twilio Content Template found for SID ${sid}`);
      console.log("");
      continue;
    }

    if (!templatesMatch(spec, remote)) {
      anyFailed = true;
      console.error("✗ The remote Twilio Content Template does not match the repository specification.");
      console.error(`Content SID: ${remote.sid}`);
      console.error("Differences:");
      for (const line of diffTemplates(spec, remote)) {
        console.error(`  - ${line}`);
      }
      console.log("");
      continue;
    }

    console.log("✓ Twilio Content Template matches the repository specification");
    console.log(`Friendly name: ${spec.friendly_name}`);
    console.log(`Content SID: ${remote.sid}`);
    console.log("");
  }

  if (anyFailed) {
    process.exitCode = 1;
  } else {
    console.log("This script never submits templates for WhatsApp approval.");
  }
}

/**
 * Runs `main()` and, if it throws (an unexpected failure outside the
 * handled missing/mismatch branches above), prints a redacted failure
 * message and sets a non-zero exit code.
 */
export async function run(): Promise<void> {
  try {
    await main();
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    try {
      message = redactCredentials(message, loadTwilioCredentialsFromEnv());
    } catch {
      // Credentials themselves aren't available — nothing to redact.
    }
    console.error("✗ Failed to verify main menu Content Templates");
    console.error(message);
    process.exitCode = 1;
  }
}

// Only auto-run when executed directly (`tsx verify-main-menu-templates.ts` /
// `npm run twilio:menu:verify`) — not when imported by tests.
if (process.argv[1] === __filename) {
  void run();
}
