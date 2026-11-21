import { config } from "dotenv";

// Point every client at the TEST database before any app module is imported.
config();
const testUrl = process.env.TEST_DATABASE_URL;
const testOwnerUrl = process.env.TEST_MIGRATION_DATABASE_URL;
if (!testUrl || !testOwnerUrl) throw new Error("TEST_DATABASE_URL and TEST_MIGRATION_DATABASE_URL must be set");
if (!/graphflow_test/.test(testUrl)) throw new Error("Refusing to run integration tests against a non-test database");
process.env.DATABASE_URL = testUrl;
process.env.MIGRATION_DATABASE_URL = testOwnerUrl;
process.env.BULLMQ_PREFIX = "graphflow-test";
process.env.SESSION_SECRET ??= "integration-test-secret-integration-test-secret";
