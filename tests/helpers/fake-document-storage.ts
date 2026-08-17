import { vi } from "vitest";
import type { BlobStorage } from "../../src/adapters/blob-storage";
import type { TwilioMediaDownloader } from "../../src/adapters/twilio/media-downloader";
import type { FilingDocumentStorageDeps } from "../../src/services/filing-document-storage";

export interface FakeDocumentStorageDeps extends FilingDocumentStorageDeps {
  mediaDownloader: TwilioMediaDownloader & { download: ReturnType<typeof vi.fn> };
  blobStorage: BlobStorage & { store: ReturnType<typeof vi.fn>; storePublic: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
}

/** A FilingDocumentStorageDeps test double — downloads, stores, and deletes succeed by default, returning a fake JPEG and a fake Blob URL. */
export function createFakeDocumentStorageDeps(): FakeDocumentStorageDeps {
  return {
    mediaDownloader: {
      download: vi.fn().mockResolvedValue({ buffer: Buffer.from("fake-file-bytes"), contentType: "image/jpeg" }),
    },
    blobStorage: {
      store: vi.fn().mockResolvedValue({ url: "https://blob.example.test/fake-file" }),
      storePublic: vi.fn().mockResolvedValue({ url: "https://blob.example.test/fake-public-file" }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  };
}
