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

interface FilingDraftListTemplateEntry {
  label: string;
  fileName: string;
  envVar: string;
}

/** #36 (Prototype parity — Phase 8)'s two Content Templates — the "My cases" list picker (the first List message type in this codebase) and the per-draft Continue/Discard/Main-menu quick-reply. */
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
 * Processes all 4 #36 templates independently, so if one succeeds and
 * another fails, every result is still reported clearly (mirrors
 * create-filing-completion-templates.ts).
 */
export async function main(): Promise<void> {
  const credentials = loadTwilioCredentialsFromEnv();
  let anyFailed = false;

  for (const entry of FILING_DRAFT_LIST_TEMPLATES) {
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
    console.error("✗ Failed to create filing-draft-list Content Templates");
    console.error(message);
    process.exitCode = 1;
  }
}

// Only auto-run when executed directly (`tsx create-filing-draft-list-templates.ts` /
// `npm run twilio:filing-draft-list:create`) — not when imported by tests.
if (process.argv[1] === __filename) {
  void run();
}
