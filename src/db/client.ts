import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { env } from "../config/env";
import * as schema from "./schema";

// neon-http (a plain fetch per query) cannot run real transactions — its
// own driver throws "No transactions support in neon-http driver". Filing
// draft creation (#8) needs an atomic read-check-branch-write with a row
// lock (SELECT ... FOR UPDATE), which requires a real session, so this app
// uses the WebSocket-based Pool instead. Node doesn't have a WebSocket
// implementation Neon can use out of the box on every supported version,
// so this wires up the `ws` package the same way Neon's own docs do.
neonConfig.webSocketConstructor = ws;

export type Db = ReturnType<typeof drizzle<typeof schema>>;
export type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Lazily created so importing this module never opens a connection —
// only the first real query does. The Pool persists across warm
// invocations under Fluid Compute rather than reconnecting every request.
let cachedPool: Pool | null = null;
let cachedDb: Db | null = null;

function getPool(): Pool {
  if (!cachedPool) {
    cachedPool = new Pool({ connectionString: env.DATABASE_URL });
  }
  return cachedPool;
}

export function getDb(): Db {
  if (!cachedDb) {
    cachedDb = drizzle(getPool(), { schema });
  }
  return cachedDb;
}

/** Runs `fn` inside a real, row-lock-capable database transaction. */
export function withTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return getDb().transaction(fn);
}
