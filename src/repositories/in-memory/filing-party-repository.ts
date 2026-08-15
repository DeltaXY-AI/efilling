import type {
  FilingPartyRecord,
  FilingPartyRepository,
  PartyRole,
  UpsertFilingPartyFieldsInput,
} from "../filing-party-repository";
import type { RepositoryTransaction } from "../transaction";

let nextId = 1;

function key(filingId: string, role: PartyRole): string {
  return `${filingId}:${role}`;
}

/** In-memory FilingPartyRepository for tests — never used in production. */
export class InMemoryFilingPartyRepository implements FilingPartyRepository {
  private readonly byKey = new Map<string, FilingPartyRecord>();

  async findByFilingAndRole(_tx: RepositoryTransaction, filingId: string, role: PartyRole): Promise<FilingPartyRecord | null> {
    return this.byKey.get(key(filingId, role)) ?? null;
  }

  async upsertFields(
    _tx: RepositoryTransaction,
    filingId: string,
    role: PartyRole,
    patch: UpsertFilingPartyFieldsInput,
  ): Promise<FilingPartyRecord> {
    const now = new Date();
    const existing = this.byKey.get(key(filingId, role));

    if (!existing) {
      const record: FilingPartyRecord = {
        id: `test-filing-party-${nextId++}`,
        filingId,
        partyRole: role,
        fullName: null,
        phoneOriginal: null,
        phoneNormalized: null,
        emailNormalized: null,
        address: null,
        filingAsRole: null,
        representativeEnrolmentNumber: null,
        entityType: null,
        status: "DRAFT",
        confirmedAt: null,
        createdAt: now,
        updatedAt: now,
        ...patch,
      };
      this.byKey.set(key(filingId, role), record);
      return record;
    }

    // Only the given keys are overwritten — mirrors the real onConflictDoUpdate's `set: patch` (#10 Part I).
    const updated: FilingPartyRecord = { ...existing, ...patch, updatedAt: now };
    this.byKey.set(key(filingId, role), updated);
    return updated;
  }

  async confirm(_tx: RepositoryTransaction, filingId: string, role: PartyRole, confirmedAt: Date): Promise<void> {
    const existing = this.byKey.get(key(filingId, role));
    if (!existing) {
      throw new Error(`InMemoryFilingPartyRepository: no party ${key(filingId, role)}`);
    }
    this.byKey.set(key(filingId, role), { ...existing, status: "CONFIRMED", confirmedAt, updatedAt: new Date() });
  }

  /** Test-wiring helper (not part of the FilingPartyRepository interface) so tests can assert a specific party's fields directly. */
  findById(id: string): FilingPartyRecord | null {
    for (const record of this.byKey.values()) {
      if (record.id === id) {
        return record;
      }
    }
    return null;
  }
}
