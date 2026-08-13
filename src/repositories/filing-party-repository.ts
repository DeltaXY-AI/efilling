import type { RepositoryTransaction } from "./transaction";

export type PartyRole = "COMPLAINANT" | "ACCUSED";
export type PartyStatus = "DRAFT" | "CONFIRMED";

export interface FilingPartyRecord {
  id: string;
  filingId: string;
  partyRole: PartyRole;
  fullName: string | null;
  /** Trimmed, as typed — never conflated with the normalized value (#10 Part C). */
  phoneOriginal: string | null;
  phoneNormalized: string | null;
  /** `null` means the advocate explicitly replied Skip (#10 Part C) — never absent-vs-skipped ambiguity. */
  emailNormalized: string | null;
  address: string | null;
  status: PartyStatus;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Patch applied by `upsertFields` — only the keys present are written.
 * `emailNormalized: null` is a meaningful, explicit value (Skip), distinct
 * from omitting the key entirely.
 */
export interface UpsertFilingPartyFieldsInput {
  fullName?: string;
  phoneOriginal?: string;
  phoneNormalized?: string;
  emailNormalized?: string | null;
  address?: string;
}

/**
 * Durable storage for one party's (complainant or, in V6B, accused)
 * contact/address details on a filing — a normalized `filing_parties` row
 * per `(filing_id, party_role)` rather than fields bolted onto `filings`
 * (#10 Part B). Every method accepts the transaction it runs in so a field
 * write, the filing's `current_step`, and the conversation's state always
 * commit atomically together.
 */
export interface FilingPartyRepository {
  findByFilingAndRole(tx: RepositoryTransaction, filingId: string, role: PartyRole): Promise<FilingPartyRecord | null>;

  /**
   * Creates the party row on first use or updates only the given fields on
   * an existing one — never overwrites unrelated columns, so editing one
   * field (#10 Part I) never clears another already-answered field. New
   * rows start `status: "DRAFT"`.
   */
  upsertFields(
    tx: RepositoryTransaction,
    filingId: string,
    role: PartyRole,
    patch: UpsertFilingPartyFieldsInput,
  ): Promise<FilingPartyRecord>;

  /** Marks the party CONFIRMED with a confirmation timestamp (#10 Part J) — does not touch any detail field. */
  confirm(tx: RepositoryTransaction, filingId: string, role: PartyRole, confirmedAt: Date): Promise<void>;
}
