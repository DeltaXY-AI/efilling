import { describe, expect, it } from "vitest";
import { storeFilingDocument, type FilingDocumentStorageDeps } from "../src/services/filing-document-storage";

function deps(overrides: Partial<FilingDocumentStorageDeps> = {}): FilingDocumentStorageDeps {
  return {
    mediaDownloader: {
      download: async () => ({ buffer: Buffer.from("fake-bytes"), contentType: "image/jpeg" }),
    },
    blobStorage: {
      store: async () => ({ url: "https://blob.example/stored.jpg" }),
      storePublic: async () => ({ url: "https://blob.example/public-stored.jpg" }),
      delete: async () => undefined,
    },
    ...overrides,
  };
}

const BASE_INPUT = {
  mediaUrl: "https://api.twilio.com/media/ME123",
  contentTypeHint: "image/jpeg",
  filingId: "filing-1",
  documentGroup: "cheque" as const,
};

describe("storeFilingDocument", () => {
  it("stores successfully and returns the durable URL", async () => {
    const result = await storeFilingDocument(deps(), BASE_INPUT);
    expect(result).toEqual({ ok: true, storageUrl: "https://blob.example/stored.jpg", contentType: "image/jpeg", extractedFields: {} });
  });

  // #40 (document auto-extraction).
  it("returns extractedFields: {} when no documentExtractor is configured, never attempting extraction", async () => {
    const result = await storeFilingDocument(deps(), BASE_INPUT);
    expect(result.ok && result.extractedFields).toEqual({});
  });

  it("runs the matching extractor for cheque/memo/notice groups and includes its result", async () => {
    const visionClient = { extractStructured: async () => ({ chequeNumber: "000123", chequeDate: "12-03-2026", chequeAmount: "45,000", bankBranch: "Test Bank" }) };
    const result = await storeFilingDocument(deps({ documentExtractor: { visionClient } }), BASE_INPUT);
    expect(result).toEqual({
      ok: true,
      storageUrl: "https://blob.example/stored.jpg",
      contentType: "image/jpeg",
      extractedFields: { chequeNumber: "000123", chequeDate: "2026-03-12", chequeAmount: "45000", bankBranch: "Test Bank" },
    });
  });

  it("never runs any extractor for the 'id' or 'support' groups, even with a documentExtractor configured", async () => {
    const extractStructured = async () => ({ chequeNumber: "should-never-be-used" });
    const result = await storeFilingDocument(deps({ documentExtractor: { visionClient: { extractStructured } } }), { ...BASE_INPUT, documentGroup: "id" as const });
    expect(result.ok && result.extractedFields).toEqual({});
  });

  it("still succeeds and returns extractedFields: {} when the vision client returns null (extraction failure)", async () => {
    const visionClient = { extractStructured: async () => null };
    const result = await storeFilingDocument(deps({ documentExtractor: { visionClient } }), BASE_INPUT);
    expect(result).toEqual({ ok: true, storageUrl: "https://blob.example/stored.jpg", contentType: "image/jpeg", extractedFields: {} });
  });

  it("rejects an unsupported content type before ever downloading", async () => {
    let downloadCalled = false;
    const result = await storeFilingDocument(
      deps({ mediaDownloader: { download: async () => { downloadCalled = true; return { buffer: Buffer.from(""), contentType: "image/jpeg" }; } } }),
      { ...BASE_INPUT, contentTypeHint: "video/mp4" },
    );
    expect(result).toEqual({ ok: false, reason: "unsupported_type" });
    expect(downloadCalled).toBe(false);
  });

  it("returns download_failed when the Twilio media download throws", async () => {
    const result = await storeFilingDocument(
      deps({ mediaDownloader: { download: async () => { throw new Error("network blip"); } } }),
      BASE_INPUT,
    );
    expect(result).toEqual({ ok: false, reason: "download_failed" });
  });

  it("returns too_large when the downloaded file exceeds the byte cap", async () => {
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
    const result = await storeFilingDocument(
      deps({ mediaDownloader: { download: async () => ({ buffer: oversized, contentType: "image/jpeg" }) } }),
      BASE_INPUT,
    );
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  // Regression test: this call was previously unguarded, so a blob-storage
  // failure (invalid/missing token, transient network error, provider
  // outage) threw uncaught all the way up to the webhook route's catch-all —
  // which acks Twilio with an empty response and never tells the sender
  // anything. From the advocate's side that looked exactly like "I sent a
  // photo and nothing happened", followed by "please send at least 1
  // file(s)" once they replied "done", because no filing_documents row was
  // ever written. This must surface as a normal, ack'd failure instead.
  it("returns storage_failed (not an uncaught throw) when the blob upload fails", async () => {
    const result = await storeFilingDocument(
      deps({
        blobStorage: {
          store: async () => { throw new Error("invalid storage token"); },
          storePublic: async () => ({ url: "https://blob.example/public-stored.jpg" }),
          delete: async () => undefined,
        },
      }),
      BASE_INPUT,
    );
    expect(result).toEqual({ ok: false, reason: "storage_failed" });
  });

  it("falls back to the webhook-provided content type hint when the downloaded response's own type isn't in the allowlist", async () => {
    const result = await storeFilingDocument(
      deps({ mediaDownloader: { download: async () => ({ buffer: Buffer.from("x"), contentType: "application/octet-stream" }) } }),
      BASE_INPUT,
    );
    expect(result).toEqual({ ok: true, storageUrl: "https://blob.example/stored.jpg", contentType: "image/jpeg", extractedFields: {} });
  });
});
