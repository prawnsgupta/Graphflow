import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the real local stack: Next.js app, background
 * worker, PostgreSQL and Redis (docker compose up -d postgres redis), using
 * the seeded DEMO organization (npm run db:seed).
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    { command: "npm run dev", url: "http://localhost:3000/api/health/live", reuseExistingServer: true, timeout: 180_000 },
    { command: "npm run worker", url: "http://localhost:9100/health", reuseExistingServer: true, timeout: 120_000 },
  ],
});
