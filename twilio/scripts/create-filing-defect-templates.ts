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

interface FilingDefectTemplateEntry {
  label: string;
  fileName: string;
  envVar: string;
}

/** #37 (Prototype parity — Phase 9)'s 5 Content Templates: the case-status screen's new actions, the defect-alert actions, the days-of-delay select, the review actions, and the sent actions. */
const FILING_DEFECT_TEMPLATES: FilingDefectTemplateEntry[] = [
  { label: "Case status actions (English)", fileName: "case-status-actions.en.json", envVar: "TWILIO_CASE_STATUS_ACTIONS_SID_EN" },
  { label: "Case status actions (Malayalam)", fileName: "case-status-actions.ml.json", envVar: "TWILIO_CASE_STATUS_ACTIONS_SID_ML" },
  { label: "Defect alert actions (English)", fileName: "defect-alert-actions.en.json", envVar: "TWILIO_DEFECT_ALERT_ACTIONS_SID_EN" },
  { label: "Defect alert actions (Malayalam)", fileName: "defect-alert-actions.ml.json", envVar: "TWILIO_DEFECT_ALERT_ACTIONS_SID_ML" },
  { label: "Defect days of delay (English)", fileName: "defect-days.en.json", envVar: "TWILIO_DEFECT_DAYS_SID_EN" },
  { label: "Defect days of delay (Malayalam)", fileName: "defect-days.ml.json", envVar: "TWILIO_DEFECT_DAYS_SID_ML" },
  { label: "Defect review actions (English)", fileName: "defect-review-actions.en.json", envVar: "TWILIO_DEFECT_REVIEW_ACTIONS_SID_EN" },
  { label: "Defect review actions (Malayalam)", fileName: "defect-review-actions.ml.json", envVar: "TWILIO_DEFECT_REVIEW_ACTIONS_SID_ML" },
  { label: "Defect sent actions (English)", fileName: "defect-sent-actions.en.json", envVar: "TWILIO_DEFECT_SENT_ACTIONS_SID_EN" },
  { label: "Defect sent actions (Malayalam)", fileName: "defect-sent-actions.ml.json", envVar: "TWILIO_DEFECT_SENT_ACTIONS_SID_ML" },
];

function loadSpec(fileName: string): ContentTemplateSpec {
  return JSON.parse(readFileSync(join(__dirname, "..", "templates", fileName), "utf8")) as ContentTemplateSpec;
}

/**
 * Processes all 10 #37 templates independently, so if one succeeds and
 * another fails, every result is still reported clearly (mirrors
 * create-filing-draft-list-templates.ts).
 */
export async function main(): Promise<void> {
  const credentials = loadTwilioCredentialsFromEnv();
  let anyFailed = false;

  for (const entry of FILING_DEFECT_TEMPLATES) {
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
    console.error("✗ Failed to create filing-defect Content Templates");
    console.error(message);
    process.exitCode = 1;
  }
}

// Only auto-run when executed directly (`tsx create-filing-defect-templates.ts` /
// `npm run twilio:filing-defect:create`) — not when imported by tests.
if (process.argv[1] === __filename) {
  void run();
}
