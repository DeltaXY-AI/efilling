import { migrate } from "drizzle-orm/neon-http/migrator";
import { getDb } from "./client";

async function main(): Promise<void> {
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  console.log("✓ Migrations applied");
}

main().catch((error) => {
  console.error("✗ Migration failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
