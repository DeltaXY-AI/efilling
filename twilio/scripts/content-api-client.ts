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
  type: string;
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

async function parseJsonOrThrow(response: Response, action: string): Promise<unknown> {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Twilio Content API ${action} failed with HTTP ${response.status}: ${text}`);
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
    const page = (await parseJsonOrThrow(response, "list")) as ContentListPage;
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

  return (await parseJsonOrThrow(response, "fetch")) as ContentResource;
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

  return (await parseJsonOrThrow(response, "create")) as ContentResource;
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
