import type {
  AddFilingDocumentInput,
  FilingDocumentGroup,
  FilingDocumentRecord,
  FilingDocumentRepository,
} from "../filing-document-repository";
import type { RepositoryTransaction } from "../transaction";

let nextId = 1;

/** In-memory FilingDocumentRepository for tests — never used in production. */
export class InMemoryFilingDocumentRepository implements FilingDocumentRepository {
  private readonly rows: FilingDocumentRecord[] = [];

  async addDocument(_tx: RepositoryTransaction, input: AddFilingDocumentInput): Promise<FilingDocumentRecord> {
    const record: FilingDocumentRecord = {
      id: `test-filing-document-${nextId++}`,
      filingId: input.filingId,
      documentGroup: input.documentGroup,
      storageUrl: input.storageUrl,
      contentType: input.contentType,
      originalTwilioMediaUrl: input.originalTwilioMediaUrl,
      createdAt: new Date(),
    };
    this.rows.push(record);
    return record;
  }

  async countByGroup(_tx: RepositoryTransaction, filingId: string, documentGroup: FilingDocumentGroup): Promise<number> {
    return this.rows.filter((row) => row.filingId === filingId && row.documentGroup === documentGroup).length;
  }

  async listByFiling(_tx: RepositoryTransaction, filingId: string): Promise<FilingDocumentRecord[]> {
    return this.rows.filter((row) => row.filingId === filingId);
  }

  async deleteByFiling(_tx: RepositoryTransaction, filingId: string): Promise<void> {
    const remaining = this.rows.filter((row) => row.filingId !== filingId);
    this.rows.length = 0;
    this.rows.push(...remaining);
  }

  /** Test-wiring helper (not part of the FilingDocumentRepository interface) so tests can assert directly without a transaction. */
  findById(id: string): FilingDocumentRecord | null {
    return this.rows.find((row) => row.id === id) ?? null;
  }
}
