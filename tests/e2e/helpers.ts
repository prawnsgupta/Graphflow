import { expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { config } from "dotenv";

config();

export const DEMO_PASSWORD = "GraphFlow!2026";

export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL("**/login", { timeout: 30_000 });
}

/** Pick an option in a Radix select identified by its accessible label. */
export async function selectOption(scope: Page | ReturnType<Page["getByRole"]>, label: string, option: string) {
  await scope.getByRole("combobox", { name: label }).click();
  const page = "page" in scope ? scope.page() : scope;
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** Read-only verification queries straight against PostgreSQL (owner role). */
export async function db<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

export async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 60_000): Promise<T> {
  const start = Date.now();
  let last: T = await fn();
  while (!ok(last)) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting; last value: ${JSON.stringify(last)}`);
    await new Promise((r) => setTimeout(r, 1000));
    last = await fn();
  }
  expect(ok(last)).toBe(true);
  return last;
}
