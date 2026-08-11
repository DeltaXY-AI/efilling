import { defineConfig } from "drizzle-kit";

// `generate` only diffs src/db/schema.ts against the committed migrations
// journal in ./drizzle — it never connects to a database, so this file does
// not require a real DATABASE_URL to run. `migrate` (src/db/migrate.ts) is
// what actually applies migrations, and that does need one.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://placeholder",
  },
});
