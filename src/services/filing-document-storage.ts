import { randomUUID } from "node:crypto";
import type { BlobStorage } from "../adapters/blob-storage";
import type { TwilioMediaDownloader } from "../adapters/twilio/media-downloader";
import { isAllowedContentType, MAX_DOCUMENT_BYTES, type FilingDocumentGroup } from "../domain/filing-document";

export type FilingDocumentStoreResult =
  | { ok: true; storageUrl: string; contentType: string }
  | { ok: false; reason: "unsupported_type" | "too_large" | "download_failed" };

export interface FilingDocumentStorageDeps {
  mediaDownloader: TwilioMediaDownloader;
  blobStorage: BlobStorage;
}

export interface StoreFilingDocumentInput {
  mediaUrl: string;
  /** Twilio's own webhook-provided MediaContentType — checked before downloading, so a clearly-disallowed type never wastes a download. */
  contentTypeHint: string;
  filingId: string;
  documentGroup: FilingDocumentGroup;
}

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

/**
 * Downloads one WhatsApp media file from Twilio and re-uploads it to durable
 * storage (#31 Part D) — the only place in this codebase where inbound media
 * is actually accepted rather than rejected. Never partially stores: a file
 * failing any check is never written to Blob and never referenced by
 * `filing_documents` (the caller only calls `filingDocumentRepo.addDocument`
 * when this returns `ok: true`).
 */
export async function storeFilingDocument(
  deps: FilingDocumentStorageDeps,
  input: StoreFilingDocumentInput,
): Promise<FilingDocumentStoreResult> {
  // Twilio tells us the content type up front in the webhook body — check it
  // before spending a download on something we'd reject anyway (#31 Part A:
  // "unsupported media type -> validation error ... no state change").
  if (!isAllowedContentType(input.contentTypeHint)) {
    return { ok: false, reason: "unsupported_type" };
  }

  let downloaded;
  try {
    downloaded = await deps.mediaDownloader.download(input.mediaUrl);
  } catch {
    return { ok: false, reason: "download_failed" };
  }

  // Twilio's webhook never states a file size up front — the only place
  // this can be checked is after the bytes are actually in hand.
  if (downloaded.buffer.byteLength > MAX_DOCUMENT_BYTES) {
    return { ok: false, reason: "too_large" };
  }

  // Prefer the real downloaded Content-Type when it's one we accept; fall
  // back to Twilio's webhook-provided hint (already validated above) if the
  // download response gave a generic/missing one — never store a file
  // without a content type that was actually validated against the allowlist.
  const contentType = isAllowedContentType(downloaded.contentType) ? downloaded.contentType : input.contentTypeHint;
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType] ?? "bin";
  const pathname = `filings/${input.filingId}/${input.documentGroup}/${randomUUID()}.${extension}`;

  const stored = await deps.blobStorage.store({ pathname, buffer: downloaded.buffer, contentType });
  return { ok: true, storageUrl: stored.url, contentType };
}
