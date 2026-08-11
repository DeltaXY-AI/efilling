import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createContentTemplate,
  diffTemplates,
  listContentTemplates,
  loadTwilioCredentialsFromEnv,
  redactCredentials,
  templatesMatch,
  type ContentTemplateSpec,
} from "./content-api-client";

const SPEC_PATH = join(__dirname, "..", "templates", "language-selection.json");

function loadSpec(): ContentTemplateSpec {
  return JSON.parse(readFileSync(SPEC_PATH, "utf8")) as ContentTemplateSpec;
}

function nextVersionSuggestion(friendlyName: string): string {
  const match = friendlyName.match(/^(.*_v)(\d+)$/);
  if (!match) {
    return `${friendlyName}_v2`;
  }
  return `${match[1]}${Number(match[2]) + 1}`;
}

export async function main(): Promise<void> {
  const credentials = loadTwilioCredentialsFromEnv();
  const spec = loadSpec();

  const matches = (await listContentTemplates(credentials)).filter(
    (resource) => resource.friendly_name === spec.friendly_name,
  );

  if (matches.length > 1) {
    console.error(`✗ Multiple Twilio Content Templates named "${spec.friendly_name}" already exist.`);
    console.error("Duplicate Content SIDs:");
    for (const resource of matches) {
      console.error(`  ${resource.sid}`);
    }
    console.error("Refusing to create another template. Resolve the duplicates in Twilio first.");
    process.exitCode = 1;
    return;
  }

  if (matches.length === 1) {
    const [remote] = matches;

    if (templatesMatch(spec, remote)) {
      console.log("✓ Existing Twilio Content Template matches the repository specification");
      console.log(`Friendly name: ${spec.friendly_name}`);
      console.log(`Content SID: ${remote.sid}`);
      console.log("No template was created.");
      return;
    }

    console.error(`✗ A Twilio Content Template named "${spec.friendly_name}" already exists but its content differs.`);
    console.error(`Content SID: ${remote.sid}`);
    console.error("Differences:");
    for (const line of diffTemplates(spec, remote)) {
      console.error(`  - ${line}`);
    }
    console.error(`Create a new versioned source file/name, e.g. "${nextVersionSuggestion(spec.friendly_name)}", instead of modifying a deployed template.`);
    process.exitCode = 1;
    return;
  }

  const created = await createContentTemplate(credentials, spec);
  console.log("✓ Twilio Content Template created");
  console.log(`Friendly name: ${spec.friendly_name}`);
  console.log(`Content SID: ${created.sid}`);
  console.log("");
  console.log("Configure locally and in Vercel:");
  console.log(`TWILIO_LANGUAGE_CONTENT_SID=${created.sid}`);
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
