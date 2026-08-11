import type { RepositoryTransaction } from "../transaction";

/**
 * The in-memory test double's concrete transaction handle. Repository
 * methods that acquire a lock during the transaction push their release
 * function here; `createInMemoryWithTransaction` releases them all (LIFO)
 * once the transaction body settles — mirroring how a real Postgres
 * transaction releases its row locks on COMMIT/ROLLBACK.
 */
export interface InMemoryTransactionHandle {
  releases: Array<() => void>;
}

/**
 * A minimal async mutex, keyed by an arbitrary string (e.g. a conversation
 * id). Used so in-memory tests can prove real serialization — two
 * "concurrent" transactions racing for the same key genuinely queue,
 * exactly like `SELECT ... FOR UPDATE` would on the real database — rather
 * than both reading stale state because JS interleaves at await points.
 */
export class InMemoryMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async acquire(key: string): Promise<() => void> {
    let release!: () => void;
    const thisTurn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previousTail = this.tails.get(key) ?? Promise.resolve();
    this.tails.set(
      key,
      previousTail.then(() => thisTurn),
    );
    await previousTail;
    return release;
  }
}

/** Builds an in-memory `withTransaction` — never used in production, only by tests. */
export function createInMemoryWithTransaction() {
  return async function withTransaction<T>(fn: (tx: RepositoryTransaction) => Promise<T>): Promise<T> {
    const handle: InMemoryTransactionHandle = { releases: [] };
    try {
      return await fn(handle);
    } finally {
      for (const release of handle.releases.reverse()) {
        release();
      }
    }
  };
}
