import { z } from "zod";

const CONTENT_API_BASE_URL = "https://content.twilio.com/v1/Content";

const credentialsSchema = z.object({
  TWILIO_ACCOUNT_SID: z.string().trim().min(1, "TWILIO_ACCOUNT_SID is required"),
  TWILIO_AUTH_TOKEN: z.string().trim().min(1, "TWILIO_AUTH_TOKEN is required"),
});

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
}

export interface QuickReplyAction {
  // Twilio's Content API does not accept/round-trip a per-action "type"
  // field for twilio/quick-reply — confirmed against a real Content
  // resource: it always comes back as just {id, title}. Comparing against
  // one would make verification permanently fail for any real template.
  title: string;
  id: string;
}

export interface ContentTemplateSpec {
  friendly_name: string;
  language: string;
  types: {
    "twilio/quick-reply": {
      body: string;
      actions: QuickReplyAction[];
    };
  };
}

export interface ContentResource extends ContentTemplateSpec {
  sid: string;
  date_created?: string;
  date_updated?: string;
  url?: string;
}

interface ContentListPage {
  contents: ContentResource[];
  meta: { next_page_url: string | null };
}

/**
 * Reads TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN from the environment. Never
 * logs their values — only the names of any missing fields.
 */
export function loadTwilioCredentialsFromEnv(): TwilioCredentials {
  const parsed = credentialsSchema.safeParse(process.env);

  if (!parsed.success) {
    const missing = Object.keys(parsed.error.flatten().fieldErrors).join(", ");
    throw new Error(`Missing Twilio credentials: ${missing}`);
  }

  return { accountSid: parsed.data.TWILIO_ACCOUNT_SID, authToken: parsed.data.TWILIO_AUTH_TOKEN };
}

function authHeader(credentials: TwilioCredentials): string {
  return `Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString("base64")}`;
}

/**
 * Replaces any literal occurrence of the configured Account SID/Auth Token
 * with a placeholder. Defense-in-depth on top of `safeErrorMessage` below —
 * applied at every point an error message is ever constructed or printed,
 * so a credential can never surface even if it reaches an error by some
 * path this module didn't anticipate.
 */
export function redactCredentials(text: string, credentials: TwilioCredentials): string {
  let redacted = text;
  if (credentials.accountSid) {
    redacted = redacted.split(credentials.accountSid).join("[REDACTED]");
  }
  if (credentials.authToken) {
    redacted = redacted.split(credentials.authToken).join("[REDACTED]");
  }
  return redacted;
}

const MAX_SAFE_ERROR_FIELD_LENGTH = 300;

interface TwilioErrorPayload {
  code?: unknown;
  message?: unknown;
  more_info?: unknown;
  status?: unknown;
}

/**
 * Twilio's own error responses are JSON with a small set of known fields
 * (code/message/more_info/status). Rather than ever including the raw
 * response body in a thrown error — which a coding agent or developer could
 * then print verbatim — this extracts only those known-safe fields, then
 * still redacts the configured credentials from them as a second layer.
 * Anything that isn't recognized Twilio error shape becomes a generic,
 * bodyless message instead of being included as-is.
 */
function safeErrorMessage(rawBody: string, credentials: TwilioCredentials): string {
  let parsed: TwilioErrorPayload;
  try {
    parsed = JSON.parse(rawBody) as TwilioErrorPayload;
  } catch {
    return "Twilio returned a non-JSON error body";
  }

  const fields = [
    typeof parsed.code === "number" || typeof parsed.code === "string" ? `code=${parsed.code}` : null,
    typeof parsed.status === "number" || typeof parsed.status === "string" ? `status=${parsed.status}` : null,
    typeof parsed.message === "string"
      ? `message=${redactCredentials(parsed.message, credentials).slice(0, MAX_SAFE_ERROR_FIELD_LENGTH)}`
      : null,
    typeof parsed.more_info === "string" ? `more_info=${redactCredentials(parsed.more_info, credentials)}` : null,
  ].filter((field): field is string => field !== null);

  return fields.length > 0 ? fields.join(" ") : "Twilio returned an error body with no recognized fields";
}

async function parseJsonOrThrow(response: Response, action: string, credentials: TwilioCredentials): Promise<unknown> {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Twilio Content API ${action} failed with HTTP ${response.status}: ${safeErrorMessage(text, credentials)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Twilio Content API ${action} returned a non-JSON response`);
  }
}

/** Lists every Content resource, following pagination until exhausted. */
export async function listContentTemplates(credentials: TwilioCredentials): Promise<ContentResource[]> {
  const resources: ContentResource[] = [];
  let url: string | null = `${CONTENT_API_BASE_URL}?PageSize=50`;

  while (url) {
    const response = await fetch(url, { headers: { Authorization: authHeader(credentials) } });
    const page = (await parseJsonOrThrow(response, "list", credentials)) as ContentListPage;
    resources.push(...page.contents);
    url = page.meta.next_page_url;
  }

  return resources;
}

/** Fetches a single Content resource by SID, or null if it does not exist. */
export async function getContentTemplate(
  credentials: TwilioCredentials,
  sid: string,
): Promise<ContentResource | null> {
  const response = await fetch(`${CONTENT_API_BASE_URL}/${sid}`, {
    headers: { Authorization: authHeader(credentials) },
  });

  if (response.status === 404) {
    return null;
  }

  return (await parseJsonOrThrow(response, "fetch", credentials)) as ContentResource;
}

/** Creates a new Content resource from the given specification. */
export async function createContentTemplate(
  credentials: TwilioCredentials,
  spec: ContentTemplateSpec,
): Promise<ContentResource> {
  const response = await fetch(CONTENT_API_BASE_URL, {
    method: "POST",
    headers: { Authorization: authHeader(credentials), "Content-Type": "application/json" },
    body: JSON.stringify(spec),
  });

  return (await parseJsonOrThrow(response, "create", credentials)) as ContentResource;
}

/**
 * Deterministically orders object keys so structurally-equal specs compare
 * equal regardless of the source field ordering. Array order is preserved —
 * quick-reply action order is significant.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      result[key] = canonicalize(record[key]);
    }
    return result;
  }

  return value;
}

/**
 * Extracts only the fields the versioning policy compares — friendly_name,
 * language, and the quick-reply body/actions — ignoring server-generated
 * fields (sid, url, date_created, date_updated). Whitespace inside the body
 * or button text is significant and is never normalized away.
 */
function comparableFields(spec: ContentTemplateSpec): unknown {
  return canonicalize({
    friendly_name: spec.friendly_name,
    language: spec.language,
    types: spec.types,
  });
}

export function templatesMatch(local: ContentTemplateSpec, remote: ContentTemplateSpec): boolean {
  return JSON.stringify(comparableFields(local)) === JSON.stringify(comparableFields(remote));
}

/** Produces a safe, structural mismatch summary. Never includes credentials. */
export function diffTemplates(local: ContentTemplateSpec, remote: ContentTemplateSpec): string[] {
  const differences: string[] = [];

  if (local.friendly_name !== remote.friendly_name) {
    differences.push(`friendly_name: local="${local.friendly_name}" remote="${remote.friendly_name}"`);
  }

  if (local.language !== remote.language) {
    differences.push(`language: local="${local.language}" remote="${remote.language}"`);
  }

  const localQuickReply = local.types["twilio/quick-reply"];
  const remoteQuickReply = remote.types["twilio/quick-reply"];

  if (!remoteQuickReply) {
    differences.push('types["twilio/quick-reply"]: missing on remote template');
  } else {
    if (localQuickReply.body !== remoteQuickReply.body) {
      differences.push('types["twilio/quick-reply"].body differs');
    }
    if (JSON.stringify(localQuickReply.actions) !== JSON.stringify(remoteQuickReply.actions)) {
      differences.push(
        `types["twilio/quick-reply"].actions differ: local=${JSON.stringify(localQuickReply.actions)} remote=${JSON.stringify(remoteQuickReply.actions)}`,
      );
    }
  }

  return differences;
}
