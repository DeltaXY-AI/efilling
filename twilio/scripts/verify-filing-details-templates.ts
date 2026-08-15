import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getContentTemplate, loadTwilioCredentialsFromEnv, redactCredentials, type ContentTemplateSpec } from "./content-api-client";
import { diffTemplates, templatesMatch } from "./template-comparison";

interface FilingDetailsTemplateEntry {
  label: string;
  fileName: string;
  envVar: string;
}

/** Mirrors create-filing-details-templates.ts's list exactly — see that file for why Parts A/B's own templates are owned elsewhere. */
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
 * Verifies all 18 configured Content SIDs independently, reporting each
 * result clearly (mirrors verify-complainant-templates.ts / verify-accused-templates.ts).
 */
export async function main(): Promise<void> {
  const credentials = loadTwilioCredentialsFromEnv();
  let anyFailed = false;

  for (const entry of FILING_DETAILS_TEMPLATES) {
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
    console.error("✗ Failed to verify filing-details Content Templates");
    console.error(message);
    process.exitCode = 1;
  }
}

// Only auto-run when executed directly (`tsx verify-filing-details-templates.ts` /
// `npm run twilio:filing-details:verify`) — not when imported by tests.
if (process.argv[1] === __filename) {
  void run();
}
