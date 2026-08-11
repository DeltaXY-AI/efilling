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

const SPEC_PATH = join(__dirname, "..", "templates", "language-selection.json");

function loadSpec(): ContentTemplateSpec {
  return JSON.parse(readFileSync(SPEC_PATH, "utf8")) as ContentTemplateSpec;
}

export async function main(): Promise<void> {
  const credentials = loadTwilioCredentialsFromEnv();
  const spec = loadSpec();

  try {
    const result = await ensureContentTemplate(credentials, spec);

    if (result.outcome === "reused") {
      console.log("✓ Existing Twilio Content Template matches the repository specification");
      console.log(`Friendly name: ${spec.friendly_name}`);
      console.log(`Content SID: ${result.sid}`);
      console.log("No template was created.");
      return;
    }

    console.log("✓ Twilio Content Template created");
    console.log(`Friendly name: ${spec.friendly_name}`);
    console.log(`Content SID: ${result.sid}`);
    console.log("");
    console.log("Configure locally and in Vercel:");
    console.log(`TWILIO_LANGUAGE_CONTENT_SID=${result.sid}`);
  } catch (error) {
    if (error instanceof DuplicateTemplatesError) {
      console.error(`✗ ${error.message}`);
      console.error("Duplicate Content SIDs:");
      for (const sid of error.sids) {
        console.error(`  ${sid}`);
      }
      console.error("Refusing to create another template. Resolve the duplicates in Twilio first.");
      process.exitCode = 1;
      return;
    }

    if (error instanceof TemplateMismatchError) {
      console.error(`✗ ${error.message}`);
      console.error(`Content SID: ${error.remoteSid}`);
      console.error("Differences:");
      for (const line of error.differences) {
        console.error(`  - ${line}`);
      }
      console.error(`Create a new versioned source file/name, e.g. "${nextVersionSuggestion(error.friendlyName)}", instead of modifying a deployed template.`);
      process.exitCode = 1;
      return;
    }

    throw error;
  }
}

/**
 * Runs `main()` and, if it throws, prints a redacted failure message and
 * sets a non-zero exit code. Exported separately from the auto-run guard
 * below so tests can exercise this exact failure path (including the
 * redaction) without relying on `process.argv`.
 */
export async function run(): Promise<void> {
  try {
    await main();
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    // Defense-in-depth: redact the configured credentials from whatever
    // reaches this catch, even if it didn't come from a Twilio Content API
    // response (which is already redacted at the source).
    try {
      message = redactCredentials(message, loadTwilioCredentialsFromEnv());
    } catch {
      // Credentials themselves aren't available — nothing to redact.
    }
    console.error("✗ Failed to create Twilio Content Template");
    console.error(message);
    process.exitCode = 1;
  }
}

// Only auto-run when executed directly (`tsx create-language-template.ts` /
// `npm run twilio:template:create`) — not when imported by tests.
if (process.argv[1] === __filename) {
  void run();
}
