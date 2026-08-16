import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getContentTemplate, loadTwilioCredentialsFromEnv, redactCredentials, type ContentTemplateSpec } from "./content-api-client";
import { diffTemplates, templatesMatch } from "./template-comparison";

interface FilingDraftListTemplateEntry {
  label: string;
  fileName: string;
  envVar: string;
}

/** Mirrors create-filing-draft-list-templates.ts's list exactly. */
const FILING_DRAFT_LIST_TEMPLATES: FilingDraftListTemplateEntry[] = [
  { label: "Filing draft list (English)", fileName: "filing-draft-list.en.json", envVar: "TWILIO_FILING_DRAFT_LIST_SID_EN" },
  { label: "Filing draft list (Malayalam)", fileName: "filing-draft-list.ml.json", envVar: "TWILIO_FILING_DRAFT_LIST_SID_ML" },
  { label: "Filing draft detail actions (English)", fileName: "filing-draft-detail-actions.en.json", envVar: "TWILIO_FILING_DRAFT_DETAIL_ACTIONS_SID_EN" },
  { label: "Filing draft detail actions (Malayalam)", fileName: "filing-draft-detail-actions.ml.json", envVar: "TWILIO_FILING_DRAFT_DETAIL_ACTIONS_SID_ML" },
];

function loadSpec(fileName: string): ContentTemplateSpec {
  return JSON.parse(readFileSync(join(__dirname, "..", "templates", fileName), "utf8")) as ContentTemplateSpec;
}

/**
 * Verifies all 4 configured Content SIDs independently, reporting each
 * result clearly (mirrors verify-filing-completion-templates.ts).
 */
export async function main(): Promise<void> {
  const credentials = loadTwilioCredentialsFromEnv();
  let anyFailed = false;

  for (const entry of FILING_DRAFT_LIST_TEMPLATES) {
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
    console.error("✗ Failed to verify filing-draft-list Content Templates");
    console.error(message);
    process.exitCode = 1;
  }
}

// Only auto-run when executed directly (`tsx verify-filing-draft-list-templates.ts` /
// `npm run twilio:filing-draft-list:verify`) — not when imported by tests.
if (process.argv[1] === __filename) {
  void run();
}
