import { withTransaction } from "../db/client";
import { DrizzleFilingRepository } from "../repositories/drizzle-filing-repository";

/**
 * #38 (Prototype parity — Phase 10) — the recommended "simple test-only
 * script" for setting a filing's next_hearing_date, since no real
 * court-calendar integration exists (out of scope; see the issue's own
 * Scope decisions). Never a user-facing feature — this is an operator tool
 * only, run directly against the database.
 *
 * Usage:
 *   npm run hearing:set-test-date -- <filingId> <ISO-8601 datetime>
 *
 * Example (28 Apr 2026, 11:00 AM IST):
 *   npm run hearing:set-test-date -- 3fa2...  2026-04-28T11:00:00+05:30
 *
 * Setting a fresh date always resets hearingAttendance and every
 * adjournment field back to null — a new hearing is a fresh cycle; a
 * stale "attending"/"adjournment_requested" answer from a previous hearing
 * must never be misread as belonging to this one.
 */

export async function main(): Promise<void> {
  const [filingId, dateArg] = process.argv.slice(2);

  if (!filingId || !dateArg) {
    console.error("Usage: npm run hearing:set-test-date -- <filingId> <ISO-8601 datetime>");
    console.error('Example: npm run hearing:set-test-date -- 3fa2...  "2026-04-28T11:00:00+05:30"');
    process.exitCode = 1;
    return;
  }

  const nextHearingDate = new Date(dateArg);
  if (Number.isNaN(nextHearingDate.getTime())) {
    console.error(`✗ "${dateArg}" is not a valid ISO-8601 datetime.`);
    process.exitCode = 1;
    return;
  }

  const filingRepo = new DrizzleFilingRepository();

  const filing = await withTransaction(async (tx) => {
    const locked = await filingRepo.lockById(tx, filingId);
    if (locked.status !== "FILED") {
      throw new Error(`Filing ${filingId} is status ${locked.status}, not FILED — a hearing date only makes sense for a filed, numbered case.`);
    }
    await filingRepo.upsertFilingFields(tx, filingId, {
      nextHearingDate,
      hearingAttendance: null,
      adjournmentGround: null,
      adjournmentRequestedDate: null,
      adjournmentIaNumber: null,
    });
    return { ...locked, nextHearingDate };
  });

  console.log(`✓ Set next_hearing_date for filing ${filing.diaryNumber ?? filingId} to ${nextHearingDate.toISOString()}.`);
  console.log("Any previous hearingAttendance/adjournment fields were reset to null.");
}

/** Runs `main()` and sets a non-zero exit code on an unexpected failure. */
export async function run(): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error("✗ set-test-hearing-date failed");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

// Only auto-run when executed directly (`tsx set-test-hearing-date.ts` /
// `npm run hearing:set-test-date`) — not when imported by tests.
if (process.argv[1] === __filename) {
  void run();
}
