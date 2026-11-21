import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Integration + RLS tests against a real PostgreSQL test database
 * (graphflow_test in the Docker Compose Postgres) and real Redis.
 *   npm run test:integration
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/support/server-only-stub.ts"),
    },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/integration/global-setup.ts"],
    setupFiles: ["tests/integration/setup-env.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
