import { z } from "zod";
import { diffTemplates, templatesMatch, type ContentTemplateSpec } from "./template-comparison";

const CONTENT_API_BASE_URL = "https://content.twilio.com/v1/Content";

const credentialsSchema = z.object({
  TWILIO_ACCOUNT_SID: z.string().trim().min(1, "TWILIO_ACCOUNT_SID is required"),
  TWILIO_AUTH_TOKEN: z.string().trim().min(1, "TWILIO_AUTH_TOKEN is required"),
});

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
}

export type { ContentTemplateSpec };

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

/** A same-name Content Template already exists but its content differs from the local spec. */
export class TemplateMismatchError extends Error {
  constructor(
    public readonly friendlyName: string,
    public readonly remoteSid: string,
    public readonly differences: string[],
  ) {
    super(`A Twilio Content Template named "${friendlyName}" already exists but its content differs.`);
    this.name = "TemplateMismatchError";
  }
}

/** More than one Content Template shares the same friendly_name — Twilio does not enforce uniqueness. */
export class DuplicateTemplatesError extends Error {
  constructor(
    public readonly friendlyName: string,
    public readonly sids: string[],
  ) {
    super(`Multiple Twilio Content Templates named "${friendlyName}" already exist.`);
    this.name = "DuplicateTemplatesError";
  }
}

/** Suggests the next version name for a template whose content has changed, e.g. "..._v1" -> "..._v2". */
export function nextVersionSuggestion(friendlyName: string): string {
  const match = friendlyName.match(/^(.*_v)(\d+)$/);
  if (!match) {
    return `${friendlyName}_v2`;
  }
  return `${match[1]}${Number(match[2]) + 1}`;
}

export interface EnsureTemplateResult {
  outcome: "created" | "reused";
  sid: string;
}

/**
 * The single idempotent create-or-reuse decision shared by every
 * create-*-template(s) script: no same-name template → create; one
 * identical same-name template → reuse; one differing same-name template →
 * throw TemplateMismatchError; more than one → throw DuplicateTemplatesError.
 * Never creates a second resource once any same-name template exists.
 */
export async function ensureContentTemplate(
  credentials: TwilioCredentials,
  spec: ContentTemplateSpec,
): Promise<EnsureTemplateResult> {
  const matches = (await listContentTemplates(credentials)).filter(
    (resource) => resource.friendly_name === spec.friendly_name,
  );

  if (matches.length > 1) {
    throw new DuplicateTemplatesError(spec.friendly_name, matches.map((resource) => resource.sid));
  }

  if (matches.length === 1) {
    const [remote] = matches;
    if (templatesMatch(spec, remote)) {
      return { outcome: "reused", sid: remote.sid };
    }
    throw new TemplateMismatchError(spec.friendly_name, remote.sid, diffTemplates(spec, remote));
  }

  const created = await createContentTemplate(credentials, spec);
  return { outcome: "created", sid: created.sid };
}
