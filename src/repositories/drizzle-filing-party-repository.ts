import { and, eq } from "drizzle-orm";
import type { Transaction } from "../db/client";
import { filingParties } from "../db/schema";
import type {
  FilingPartyRecord,
  FilingPartyRepository,
  PartyRole,
  UpsertFilingPartyFieldsInput,
} from "./filing-party-repository";
import type { RepositoryTransaction } from "./transaction";

export class DrizzleFilingPartyRepository implements FilingPartyRepository {
  async findByFilingAndRole(tx: RepositoryTransaction, filingId: string, role: PartyRole): Promise<FilingPartyRecord | null> {
    const [row] = await (tx as Transaction)
      .select()
      .from(filingParties)
      .where(and(eq(filingParties.filingId, filingId), eq(filingParties.partyRole, role)))
      .limit(1);

    return row ?? null;
  }

  async upsertFields(
    tx: RepositoryTransaction,
    filingId: string,
    role: PartyRole,
    patch: UpsertFilingPartyFieldsInput,
  ): Promise<FilingPartyRecord> {
    const t = tx as Transaction;
    const now = new Date();

    const [row] = await t
      .insert(filingParties)
      .values({ filingId, partyRole: role, ...patch })
      .onConflictDoUpdate({
        target: [filingParties.filingId, filingParties.partyRole],
        // Only the given keys are overwritten — the unique constraint's
        // conflict target guarantees this always targets the one existing
        // row, and `set` never includes columns outside `patch`, so an
        // unrelated already-answered field is never touched (#10 Part I).
        set: { ...patch, updatedAt: now },
      })
      .returning();

    return row;
  }

  async confirm(tx: RepositoryTransaction, filingId: string, role: PartyRole, confirmedAt: Date): Promise<void> {
    await (tx as Transaction)
      .update(filingParties)
      .set({ status: "CONFIRMED", confirmedAt, updatedAt: new Date() })
      .where(and(eq(filingParties.filingId, filingId), eq(filingParties.partyRole, role)));
  }
}
