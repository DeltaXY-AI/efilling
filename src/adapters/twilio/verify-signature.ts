import { validateRequest } from "twilio";

/**
 * Builds the exact URL Twilio signed, per Twilio's signature requirements:
 * the public URL configured in the Sandbox plus the path/query Express
 * actually received. Deliberately does not fall back to proxy headers
 * (e.g. `req.protocol`/`req.hostname` on Vercel), which can be spoofed or
 * rewritten and would make signature validation unreliable.
 */
export function buildTwilioWebhookUrl(publicBaseUrl: string, originalUrl: string): string {
  return `${publicBaseUrl.replace(/\/+$/, "")}${originalUrl}`;
}

/**
 * Verifies that a request genuinely came from Twilio. Returns false (rather
 * than throwing) for a missing header so callers can treat "missing" and
 * "invalid" signatures the same way, without ever calling into the
 * validation library with an undefined header.
 */
export function isValidTwilioSignature(
  authToken: string,
  signature: string | undefined,
  url: string,
  params: Record<string, unknown>,
): boolean {
  if (!signature) {
    return false;
  }

  return validateRequest(authToken, signature, url, params);
}
