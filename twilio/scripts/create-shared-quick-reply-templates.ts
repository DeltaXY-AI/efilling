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

interface SharedTemplateEntry {
  label: string;
  fileName: string;
  envVar: string;
}

/**
 * The 3 generic quick-reply templates behind the "done"/"skip"/"sample"
 * button rollout: one reused as-is by every optional free-text field
 * (complainant email, accused phone, filing details bank/branch and story),
 * one reused by every document-upload group's "Done"/"Add sample files"
 * prompt, and one reused by the defect-2 re-upload screen's "Done"-only
 * prompt. All 3 use a `{{1}}` body variable — the calling workflow supplies
 * its own field-specific copy at send time (see filing-sender.ts's
 * sendFilingPromptWithOptionalButton), so this script never needs to know
 * about any individual field's wording.
 */
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
 * Processes all 6 templates independently, so if one succeeds and another
 * fails, every result is still reported clearly (never lets one failure
 * abort processing of the rest, and never creates anything for a name that
 * already has a mismatch/duplicate on a later run).
 */
export async function main(): Promise<void> {
  const credentials = loadTwilioCredentialsFromEnv();
  let anyFailed = false;

  for (const entry of SHARED_TEMPLATES) {
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
    console.error("✗ Failed to create the shared quick-reply Content Templates");
    console.error(message);
    process.exitCode = 1;
  }
}

// Only auto-run when executed directly (`tsx create-shared-quick-reply-templates.ts` /
// `npm run twilio:shared:create`) — not when imported by tests.
if (process.argv[1] === __filename) {
  void run();
}
