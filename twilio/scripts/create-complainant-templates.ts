import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DuplicateTemplatesError,
  TemplateMismatchError,
  ensureContentTemplate,
  loadTwilioCredentialsFromEnv,
  nextVersionSuggestion,
  redactCredentials,
  type ContentTemplateSpec,
} from "./content-api-client";

interface ComplainantTemplateEntry {
  label: string;
  fileName: string;
  envVar: string;
}

const COMPLAINANT_TEMPLATES: ComplainantTemplateEntry[] = [
  { label: "Complainant review actions (English)", fileName: "complainant-review-actions.en.json", envVar: "TWILIO_COMPLAINANT_REVIEW_SID_EN" },
  { label: "Complainant review actions (Malayalam)", fileName: "complainant-review-actions.ml.json", envVar: "TWILIO_COMPLAINANT_REVIEW_SID_ML" },
  { label: "Complainant edit fields (English)", fileName: "complainant-edit-fields.en.json", envVar: "TWILIO_COMPLAINANT_EDIT_FIELDS_SID_EN" },
  { label: "Complainant edit fields (Malayalam)", fileName: "complainant-edit-fields.ml.json", envVar: "TWILIO_COMPLAINANT_EDIT_FIELDS_SID_ML" },
  // #33 Part A.
  { label: "Complainant \"Filing as\" role (English)", fileName: "complainant-role.en.json", envVar: "TWILIO_COMPLAINANT_ROLE_SID_EN" },
  { label: "Complainant \"Filing as\" role (Malayalam)", fileName: "complainant-role.ml.json", envVar: "TWILIO_COMPLAINANT_ROLE_SID_ML" },
];

function loadSpec(fileName: string): ContentTemplateSpec {
  return JSON.parse(readFileSync(join(__dirname, "..", "templates", fileName), "utf8")) as ContentTemplateSpec;
}

/**
 * Processes all four #10 templates independently, so if one succeeds and
 * another fails, every result is still reported clearly (never lets one
 * failure abort processing of the rest, and never creates anything for a
 * name that already has a mismatch/duplicate on a later run).
 */
export async function main(): Promise<void> {
  const credentials = loadTwilioCredentialsFromEnv();
  let anyFailed = false;

  for (const entry of COMPLAINANT_TEMPLATES) {
    const spec = loadSpec(entry.fileName);
    console.log(`--- ${entry.label} (${spec.friendly_name}) ---`);

    try {
      const result = await ensureContentTemplate(credentials, spec);

      console.log(
        result.outcome === "reused"
          ? "✓ Existing Twilio Content Template matches the repository specification"
          : "✓ Twilio Content Template created",
      );
      console.log(`Friendly name: ${spec.friendly_name}`);
      console.log(`Content SID: ${result.sid}`);
      console.log(`Configure locally and in Vercel: ${entry.envVar}=${result.sid}`);
    } catch (error) {
      anyFailed = true;

      if (error instanceof DuplicateTemplatesError) {
        console.error(`✗ ${error.message}`);
        console.error("Duplicate Content SIDs:");
        for (const sid of error.sids) {
          console.error(`  ${sid}`);
        }
        console.error("Refusing to create another template. Resolve the duplicates in Twilio first.");
      } else if (error instanceof TemplateMismatchError) {
        console.error(`✗ ${error.message}`);
        console.error(`Content SID: ${error.remoteSid}`);
        console.error("Differences:");
        for (const line of error.differences) {
          console.error(`  - ${line}`);
        }
        console.error(`Create a new versioned source file/name, e.g. "${nextVersionSuggestion(error.friendlyName)}", instead of modifying a deployed template.`);
      } else {
        // An unexpected failure (network error, Twilio outage, etc.) must
        // still not abort the remaining templates — record it and continue.
        const message = redactCredentials(error instanceof Error ? error.message : String(error), credentials);
        console.error(`✗ ${entry.label} template failed: ${message}`);
      }
    }

    console.log("");
  }

  if (anyFailed) {
    process.exitCode = 1;
  }
}

/**
 * Runs `main()` and, if it throws (an unexpected failure outside the
 * handled mismatch/duplicate branches above), prints a redacted failure
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
    console.error("✗ Failed to create complainant-details Content Templates");
    console.error(message);
    process.exitCode = 1;
  }
}

// Only auto-run when executed directly (`tsx create-complainant-templates.ts` /
// `npm run twilio:complainant:create`) — not when imported by tests.
if (process.argv[1] === __filename) {
  void run();
}
