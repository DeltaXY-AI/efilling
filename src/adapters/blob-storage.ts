import { put } from "@vercel/blob";

/**
 * Durable file storage (#31 Part D) — the destination every downloaded
 * Twilio media file is re-uploaded to, so it survives after Twilio's own
 * `MediaUrl` expires. Behind an interface (mirroring `TwilioMessagingClient`)
 * so workflow code depends on a contract, not the `@vercel/blob` SDK
 * directly, and tests can inject a fake instead of calling Vercel.
 */
export interface BlobStorage {
  store(input: { pathname: string; buffer: Buffer; contentType: string }): Promise<{ url: string }>;
}

/**
 * Filing documents are sensitive (cheque images, ID proofs) and are never
 * meant to be served publicly — only this application ever needs to read
 * them back — so every upload is `access: "private"`, never `"public"`.
 */
export function createVercelBlobStorage(token: string): BlobStorage {
  return {
    async store({ pathname, buffer, contentType }) {
      const blob = await put(pathname, buffer, { access: "private", contentType, token });
      return { url: blob.url };
    },
  };
}
