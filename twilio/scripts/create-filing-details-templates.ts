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

interface FilingDetailsTemplateEntry {
  label: string;
  fileName: string;
  envVar: string;
}

/** #33 (Prototype parity — Phase 5) Parts C/D/F's rich Content Templates — return reason, paid, witness, court, review-actions, the 2-level edit picker, and declare. Parts A/B's own templates ("Filing as", entity type) are owned by create-complainant-templates.ts / create-accused-templates.ts respectively, alongside that same screen's other templates. */
const FILING_DETAILS_TEMPLATES: FilingDetailsTemplateEntry[] = [
  { label: "Filing return reason (English)", fileName: "filing-return-reason.en.json", envVar: "TWILIO_FILING_RETURN_REASON_SID_EN" },
  { label: "Filing return reason (Malayalam)", fileName: "filing-return-reason.ml.json", envVar: "TWILIO_FILING_RETURN_REASON_SID_ML" },
  { label: "Filing paid after notice (English)", fileName: "filing-part-payment.en.json", envVar: "TWILIO_FILING_PART_PAYMENT_SID_EN" },
  { label: "Filing paid after notice (Malayalam)", fileName: "filing-part-payment.ml.json", envVar: "TWILIO_FILING_PART_PAYMENT_SID_ML" },
  { label: "Filing witness (English)", fileName: "filing-witness.en.json", envVar: "TWILIO_FILING_WITNESS_SID_EN" },
  { label: "Filing witness (Malayalam)", fileName: "filing-witness.ml.json", envVar: "TWILIO_FILING_WITNESS_SID_ML" },
  { label: "Filing court (English)", fileName: "filing-court.en.json", envVar: "TWILIO_FILING_COURT_SID_EN" },
  { label: "Filing court (Malayalam)", fileName: "filing-court.ml.json", envVar: "TWILIO_FILING_COURT_SID_ML" },
  { label: "Filing review actions (English)", fileName: "filing-review-actions.en.json", envVar: "TWILIO_FILING_REVIEW_ACTIONS_SID_EN" },
  { label: "Filing review actions (Malayalam)", fileName: "filing-review-actions.ml.json", envVar: "TWILIO_FILING_REVIEW_ACTIONS_SID_ML" },
  { label: "Filing edit group (English)", fileName: "filing-edit-group.en.json", envVar: "TWILIO_FILING_EDIT_GROUP_SID_EN" },
  { label: "Filing edit group (Malayalam)", fileName: "filing-edit-group.ml.json", envVar: "TWILIO_FILING_EDIT_GROUP_SID_ML" },
  { label: "Filing edit cheque field (English)", fileName: "filing-edit-cheque-field.en.json", envVar: "TWILIO_FILING_EDIT_CHEQUE_FIELD_SID_EN" },
  { label: "Filing edit cheque field (Malayalam)", fileName: "filing-edit-cheque-field.ml.json", envVar: "TWILIO_FILING_EDIT_CHEQUE_FIELD_SID_ML" },
  { label: "Filing edit narrative field (English)", fileName: "filing-edit-narrative-field.en.json", envVar: "TWILIO_FILING_EDIT_NARRATIVE_FIELD_SID_EN" },
  { label: "Filing edit narrative field (Malayalam)", fileName: "filing-edit-narrative-field.ml.json", envVar: "TWILIO_FILING_EDIT_NARRATIVE_FIELD_SID_ML" },
  { label: "Filing declare (English)", fileName: "filing-declare.en.json", envVar: "TWILIO_FILING_DECLARE_SID_EN" },
  { label: "Filing declare (Malayalam)", fileName: "filing-declare.ml.json", envVar: "TWILIO_FILING_DECLARE_SID_ML" },
];

function loadSpec(fileName: string): ContentTemplateSpec {
  return JSON.parse(readFileSync(join(__dirname, "..", "templates", fileName), "utf8")) as ContentTemplateSpec;
}

/**
 * Processes all 18 #33 Parts C/D/F templates independently, so if one
 * succeeds and another fails, every result is still reported clearly
 * (mirrors create-complainant-templates.ts / create-accused-templates.ts).
 */
export async function main(): Promise<void> {
  const credentials = loadTwilioCredentialsFromEnv();
  let anyFailed = false;

  for (const entry of FILING_DETAILS_TEMPLATES) {
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
    console.error("✗ Failed to create filing-details Content Templates");
    console.error(message);
    process.exitCode = 1;
  }
}

// Only auto-run when executed directly (`tsx create-filing-details-templates.ts` /
// `npm run twilio:filing-details:create`) — not when imported by tests.
if (process.argv[1] === __filename) {
  void run();
}
