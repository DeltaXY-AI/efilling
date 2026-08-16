import { and, eq } from "drizzle-orm";
import type { Transaction } from "../db/client";
import { filingDocuments } from "../db/schema";
import type {
  AddFilingDocumentInput,
  FilingDocumentGroup,
  FilingDocumentRecord,
  FilingDocumentRepository,
} from "./filing-document-repository";
import type { RepositoryTransaction } from "./transaction";

export class DrizzleFilingDocumentRepository implements FilingDocumentRepository {
  async addDocument(tx: RepositoryTransaction, input: AddFilingDocumentInput): Promise<FilingDocumentRecord> {
    const [row] = await (tx as Transaction)
      .insert(filingDocuments)
      .values({
        filingId: input.filingId,
        documentGroup: input.documentGroup,
        storageUrl: input.storageUrl,
        contentType: input.contentType,
        originalTwilioMediaUrl: input.originalTwilioMediaUrl,
      })
      .returning();

    return row;
  }

  async countByGroup(tx: RepositoryTransaction, filingId: string, documentGroup: FilingDocumentGroup): Promise<number> {
    const rows = await (tx as Transaction)
      .select({ id: filingDocuments.id })
      .from(filingDocuments)
      .where(and(eq(filingDocuments.filingId, filingId), eq(filingDocuments.documentGroup, documentGroup)));

    return rows.length;
  }

  async listByFiling(tx: RepositoryTransaction, filingId: string): Promise<FilingDocumentRecord[]> {
    return (tx as Transaction).select().from(filingDocuments).where(eq(filingDocuments.filingId, filingId));
  }

  async deleteByFiling(tx: RepositoryTransaction, filingId: string): Promise<void> {
    await (tx as Transaction).delete(filingDocuments).where(eq(filingDocuments.filingId, filingId));
  }
}
