import { randomUUID } from "node:crypto";
import type { BlobStorage } from "../adapters/blob-storage";
import type { TwilioMediaDownloader } from "../adapters/twilio/media-downloader";
import { isAllowedContentType, MAX_DOCUMENT_BYTES, type FilingDocumentGroup } from "../domain/filing-document";
import { extractChequeFields, extractMemoFields, extractNoticeFields, type DocumentExtractionDeps } from "./document-extraction";

export type FilingDocumentStoreResult =
  | { ok: true; storageUrl: string; contentType: string; extractedFields: Record<string, unknown> }
  | { ok: false; reason: "unsupported_type" | "too_large" | "download_failed" | "storage_failed" };

export interface FilingDocumentStorageDeps {
  mediaDownloader: TwilioMediaDownloader;
  blobStorage: BlobStorage;
  /**
   * #40 (document auto-extraction) — optional. When unset, `extractedFields`
   * is always `{}` and every upload behaves exactly as it did before this
   * feature existed. Only consulted for the "cheque"/"memo"/"notice" groups
   * (see EXTRACTABLE_GROUPS below) — "id" and "support" documents are never
   * sent anywhere for reading.
   */
  documentExtractor?: DocumentExtractionDeps;
}

const EXTRACTABLE_GROUPS: ReadonlySet<FilingDocumentGroup> = new Set(["cheque", "memo", "notice"]);

/** Dispatches to the one extractor matching this document's group — never called for "id"/"support"/"narrative" (see EXTRACTABLE_GROUPS above). */
async function extractForGroup(
  extractor: DocumentExtractionDeps,
  group: FilingDocumentGroup,
  buffer: Buffer,
  contentType: string,
): Promise<Record<string, unknown>> {
  // Each extractor's result type only names its own known fields (never an
  // index signature) — this cast is safe because storeFilingDocument's own
  // caller (applyExtractedFields in filing-document-workflow.ts) only ever
  // reads back the exact same named keys these interfaces declare.
  if (group === "cheque") return (await extractChequeFields(extractor, buffer, contentType)) as unknown as Record<string, unknown>;
  if (group === "memo") return (await extractMemoFields(extractor, buffer, contentType)) as unknown as Record<string, unknown>;
  if (group === "notice") return (await extractNoticeFields(extractor, buffer, contentType)) as unknown as Record<string, unknown>;
  return {};
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

  // The upload can fail for reasons entirely outside the sender's control
  // (misconfigured/invalid storage credentials, a transient network error,
  // the storage provider being unreachable). Previously this was left
  // unguarded: an exception here propagated all the way up through the
  // webhook route's own catch-all, which acks Twilio with an empty TwiML
  // response and logs the failure server-side — but never tells the user
  // anything. The result looked exactly like a file that was never sent:
  // no acknowledgement, and then "please send at least 1 file(s)" once they
  // replied "done". Catching it here restores the same never-silent
  // contract every other failure reason in this function already has.
  let stored;
  try {
    stored = await deps.blobStorage.store({ pathname, buffer: downloaded.buffer, contentType });
  } catch {
    return { ok: false, reason: "storage_failed" };
  }

  // #40 (document auto-extraction): best-effort, never allowed to affect
  // whether this upload itself succeeds — deps.documentExtractor is
  // optional, and extractForGroup's own extractors never throw (their
  // underlying VisionClient.extractStructured contract returns null on any
  // failure), but this is wrapped anyway so a future extractor bug can never
  // turn a successful upload into a failed one.
  let extractedFields: Record<string, unknown> = {};
  if (deps.documentExtractor && EXTRACTABLE_GROUPS.has(input.documentGroup)) {
    try {
      extractedFields = await extractForGroup(deps.documentExtractor, input.documentGroup, downloaded.buffer, contentType);
    } catch {
      extractedFields = {};
    }
  }

  return { ok: true, storageUrl: stored.url, contentType, extractedFields };
}
