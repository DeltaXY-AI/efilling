import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a Kapso webhook signature (`X-Webhook-Signature`, HMAC-SHA256)
 * over the exact raw request bytes. Per Kapso's docs, the signature must be
 * computed over the raw JSON body — never a re-serialized parsed object,
 * which is not guaranteed to byte-for-byte match what Kapso actually signed
 * (key order, whitespace). The caller is responsible for capturing
 * `rawBody` before any JSON parsing happens (see kapso-webhook.route.ts).
 *
 * Returns false (rather than throwing) for a missing signature or a
 * length mismatch, so callers can treat "missing" and "invalid" the same
 * way without ever calling into timingSafeEqual with mismatched buffers
 * (which throws instead of returning false).
 */
export function isValidKapsoSignature(secret: string, signature: string | undefined, rawBody: Buffer): boolean {
  if (!signature) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const signatureBuffer = Buffer.from(signature, "utf8");

  if (expectedBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return timingSafeEqual(signatureBuffer, expectedBuffer);
}
