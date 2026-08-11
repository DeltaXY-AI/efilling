/**
 * Opaque transaction handle threaded through repository methods that must
 * run atomically together (see `withTransaction` in src/db/client.ts).
 * Kept untyped here so repository interfaces don't depend on Drizzle
 * directly — the Drizzle-backed implementations narrow it to the real
 * driver's transaction type; in-memory test doubles ignore it entirely.
 */
export type RepositoryTransaction = unknown;
