import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getContentTemplate, loadTwilioCredentialsFromEnv, redactCredentials, type ContentTemplateSpec } from "./content-api-client";
import { diffTemplates, templatesMatch } from "./template-comparison";

interface CaseTypeTemplateEntry {
  label: string;
  fileName: string;
  envVar: string;
}

const CASE_TYPE_TEMPLATES: CaseTypeTemplateEntry[] = [
  { label: "Case-type prompt (English)", fileName: "filing-case-type.en.json", envVar: "TWILIO_FILING_CASE_TYPE_SID_EN" },
  { label: "Case-type prompt (Malayalam)", fileName: "filing-case-type.ml.json", envVar: "TWILIO_FILING_CASE_TYPE_SID_ML" },
  { label: "Other case types list (English)", fileName: "filing-other-case-types.en.json", envVar: "TWILIO_FILING_OTHER_CASE_TYPES_SID_EN" },
  { label: "Other case types list (Malayalam)", fileName: "filing-other-case-types.ml.json", envVar: "TWILIO_FILING_OTHER_CASE_TYPES_SID_ML" },
];

function loadSpec(fileName: string): ContentTemplateSpec {
  return JSON.parse(readFileSync(join(__dirname, "..", "templates", fileName), "utf8")) as ContentTemplateSpec;
}

/**
 * Verifies all four configured Content SIDs independently, reporting each
 * result clearly. A missing SID or an API failure for one is recorded and
 * the rest are still checked, never aborted.
 */
export async function main(): Promise<void> {
  const credentials = loadTwilioCredentialsFromEnv();
  let anyFailed = false;

  for (const entry of CASE_TYPE_TEMPLATES) {
    const spec = loadSpec(entry.fileName);
    console.log(`--- ${entry.label} (${spec.friendly_name}) ---`);

    const sid = process.env[entry.envVar]?.trim();
    if (!sid) {
      anyFailed = true;
      console.error(`✗ ${entry.envVar} is not configured.`);
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
    console.error("✗ Failed to verify case-type Content Templates");
    console.error(message);
    process.exitCode = 1;
  }
}

// Only auto-run when executed directly (`tsx verify-case-type-templates.ts` /
// `npm run twilio:case-type:verify`) — not when imported by tests.
if (process.argv[1] === __filename) {
  void run();
}
