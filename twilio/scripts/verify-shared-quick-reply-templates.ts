import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getContentTemplate, loadTwilioCredentialsFromEnv, redactCredentials, type ContentTemplateSpec } from "./content-api-client";
import { diffTemplates, templatesMatch } from "./template-comparison";

interface SharedTemplateEntry {
  label: string;
  fileName: string;
  envVar: string;
}

const SHARED_TEMPLATES: SharedTemplateEntry[] = [
  { label: "Shared field Skip button (English)", fileName: "filing-field-skip.en.json", envVar: "TWILIO_FIELD_SKIP_SID_EN" },
  { label: "Shared field Skip button (Malayalam)", fileName: "filing-field-skip.ml.json", envVar: "TWILIO_FIELD_SKIP_SID_ML" },
  { label: "Shared Done/Add-sample-files buttons (English)", fileName: "filing-doc-continue.en.json", envVar: "TWILIO_DOC_CONTINUE_SID_EN" },
  { label: "Shared Done/Add-sample-files buttons (Malayalam)", fileName: "filing-doc-continue.ml.json", envVar: "TWILIO_DOC_CONTINUE_SID_ML" },
  { label: "Shared Done-only button (English)", fileName: "filing-doc-continue-only.en.json", envVar: "TWILIO_DOC_CONTINUE_ONLY_SID_EN" },
  { label: "Shared Done-only button (Malayalam)", fileName: "filing-doc-continue-only.ml.json", envVar: "TWILIO_DOC_CONTINUE_ONLY_SID_ML" },
];

function loadSpec(fileName: string): ContentTemplateSpec {
  return JSON.parse(readFileSync(join(__dirname, "..", "templates", fileName), "utf8")) as ContentTemplateSpec;
}

/**
 * Verifies all 6 configured Content SIDs independently, reporting each
 * result clearly. Each template's env var is validated and fetched inside
 * the loop — a missing SID or an API failure for one is recorded and the
 * rest are still checked, never aborted. Unlike every other verify-*
 * script, a missing env var here is expected in a repo that hasn't
 * provisioned these optional buttons yet — see .env.example.
 */
export async function main(): Promise<void> {
  const credentials = loadTwilioCredentialsFromEnv();
  let anyFailed = false;

  for (const entry of SHARED_TEMPLATES) {
    const spec = loadSpec(entry.fileName);
    console.log(`--- ${entry.label} (${spec.friendly_name}) ---`);

    const sid = process.env[entry.envVar]?.trim();
    if (!sid) {
      console.log(`○ ${entry.envVar} is not configured — this button stays off (its field falls back to plain text).`);
      console.log("");
      continue;
    }

    try {
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
    } catch (error) {
      anyFailed = true;
      const message = redactCredentials(error instanceof Error ? error.message : String(error), credentials);
      console.error(`✗ ${entry.label} verification failed: ${message}`);
      console.log("");
    }
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
    console.error("✗ Failed to verify the shared quick-reply Content Templates");
    console.error(message);
    process.exitCode = 1;
  }
}

// Only auto-run when executed directly (`tsx verify-shared-quick-reply-templates.ts` /
// `npm run twilio:shared:verify`) — not when imported by tests.
if (process.argv[1] === __filename) {
  void run();
}
