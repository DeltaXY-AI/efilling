import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "../config/env";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

// Lazily created so importing this module never opens a connection —
// only the first real query does.
let cachedDb: Db | null = null;

export function getDb(): Db {
  if (!cachedDb) {
    const sql = neon(env.DATABASE_URL);
    cachedDb = drizzle(sql, { schema });
  }
  return cachedDb;
}
