import { execSync } from "node:child_process";
import { config } from "dotenv";

/**
 * Apply all migrations (schema + RLS) to the dedicated test database.
 * `migrate deploy` is non-destructive: it only applies pending migrations.
 * Tests isolate themselves by creating uniquely-named organizations and
 * deleting them afterwards, so no database reset is needed.
 */
export default function setup() {
  config();
  const url = process.env.TEST_DATABASE_URL;
  const owner = process.env.TEST_MIGRATION_DATABASE_URL;
  if (!url || !owner || !/graphflow_test/.test(owner)) throw new Error("TEST_* database URLs must point at graphflow_test");
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, MIGRATION_DATABASE_URL: owner },
  });
}
