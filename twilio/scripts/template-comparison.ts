/**
 * Structural comparison for Twilio Content Templates, shared by every
 * template-as-code script (#3's language picker, #5's main menu, and any
 * future template). Generic over the `types` payload so it works for
 * twilio/quick-reply, twilio/list-picker, or any other content type without
 * a second implementation per template kind.
 */

export interface ContentTemplateSpec {
  friendly_name: string;
  language: string;
  types: Record<string, unknown>;
}

/**
 * Deterministically orders object keys so structurally-equal specs compare
 * equal regardless of the source field ordering. Array order is preserved —
 * item/action order is significant for both quick-reply and list-picker.
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
 * language, and the full `types` payload — ignoring server-generated fields
 * (sid, url, date_created, date_updated). Whitespace inside body/item text
 * is significant and is never normalized away.
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Recursively walks the two canonical (already key-sorted) representations
 * and records every path where they differ, so the same logic reports a
 * changed quick-reply action's title/id, a list-picker item's description,
 * a missing content type, or anything else without type-specific code.
 */
function collectDifferences(path: string, local: unknown, remote: unknown, out: string[]): void {
  if (JSON.stringify(local) === JSON.stringify(remote)) {
    return;
  }

  if (Array.isArray(local) && Array.isArray(remote)) {
    const length = Math.max(local.length, remote.length);
    for (let index = 0; index < length; index += 1) {
      const itemPath = `${path}[${index}]`;
      if (index >= local.length) {
        out.push(`${itemPath}: missing locally, present on remote`);
      } else if (index >= remote.length) {
        out.push(`${itemPath}: present locally, missing on remote`);
      } else {
        collectDifferences(itemPath, local[index], remote[index], out);
      }
    }
    return;
  }

  if (isPlainObject(local) && isPlainObject(remote)) {
    const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in local)) {
        out.push(`${childPath}: missing locally, present on remote`);
      } else if (!(key in remote)) {
        out.push(`${childPath}: present locally, missing on remote`);
      } else {
        collectDifferences(childPath, local[key], remote[key], out);
      }
    }
    return;
  }

  out.push(`${path}: local=${JSON.stringify(local)} remote=${JSON.stringify(remote)}`);
}

/** Produces a safe, structural mismatch summary. Never includes credentials — it never sees any. */
export function diffTemplates(local: ContentTemplateSpec, remote: ContentTemplateSpec): string[] {
  const differences: string[] = [];
  collectDifferences("", comparableFields(local), comparableFields(remote), differences);
  return differences;
}
