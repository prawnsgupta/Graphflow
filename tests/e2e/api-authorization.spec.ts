/** Direct API calls cannot bypass authorization (application checks + RLS). */
import { expect, request, test, type APIRequestContext } from "@playwright/test";
import { db, DEMO_PASSWORD } from "./helpers";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

async function session(email: string): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });
  const res = await ctx.post("/api/auth/login", { data: { email, password: DEMO_PASSWORD } });
  expect(res.ok()).toBe(true);
  return ctx;
}

const idOf = async (sql: string, params: unknown[] = []) => (await db<{ id: string }>(sql, params))[0].id;

test("unauthenticated requests are rejected", async () => {
  const anon = await request.newContext({ baseURL: BASE });
  expect((await anon.get("/api/analytics/overview")).status()).toBe(401);
  expect((await anon.get("/api/timesheets")).status()).toBe(401);
  expect((await anon.post("/api/events", { data: { events: [] }, headers: { authorization: "Bearer gfd_invalid" } })).status()).toBe(401);
});

test("an employee cannot reach restricted data through the API", async () => {
  const liam = await session("liam@graphflow.demo");
  const emma = await idOf(`SELECT id FROM users WHERE email = 'emma@graphflow.demo'`);
  const liamId = await idOf(`SELECT id FROM users WHERE email = 'liam@graphflow.demo'`);
  const foreignProject = await idOf(`SELECT p.id FROM projects p JOIN organizations o ON o.id = p.organization_id WHERE o.slug = 'northwind-demo'`);

  expect((await liam.get("/api/employees")).status()).toBe(403);
  expect((await liam.get("/api/activity/raw")).status()).toBe(403);
  expect((await liam.get("/api/audit-logs")).status()).toBe(403);
  expect((await liam.get(`/api/employees/${emma}/analytics`)).status()).toBe(404);
  expect((await liam.get(`/api/projects/${foreignProject}`)).status()).toBe(404);
  expect((await liam.patch(`/api/employees/${liamId}`, { data: { role: "ORG_ADMIN" } })).status()).toBe(403);
  expect((await liam.get("/api/reports/organization-monthly")).status()).toBe(403);

  // Activity API only ever returns the caller's own records.
  const activity = (await (await liam.get("/api/activity?pageSize=200")).json()).data;
  expect(activity.items.every((a: { user: { id: string } }) => a.user.id === liamId)).toBe(true);
});

test("a project manager cannot approve timesheets of projects they do not manage", async () => {
  const olivia = await session("olivia.pm@graphflow.demo");
  const nimbusTimesheet = await idOf(
    `SELECT t.id FROM timesheets t JOIN projects p ON p.id = t.project_id WHERE p.name = 'Nimbus Mobile App' AND t.status = 'SUBMITTED' LIMIT 1`,
  );
  const res = await olivia.post(`/api/timesheets/${nimbusTimesheet}/approve`, { data: {} });
  expect([403, 404]).toContain(res.status());
  const [after] = await db<{ status: string }>(`SELECT status FROM timesheets WHERE id = $1`, [nimbusTimesheet]);
  expect(after.status).toBe("SUBMITTED");
});

test("state-changing requests without a same-origin header are rejected (CSRF)", async () => {
  const withOrigin = await session("liam@graphflow.demo");
  const state = await withOrigin.storageState();
  const noOrigin = await request.newContext({ baseURL: BASE, storageState: state });
  const res = await noOrigin.post("/api/settings/consent", { data: { trackingConsent: true } });
  expect(res.status()).toBe(403);
  const evil = await request.newContext({ baseURL: BASE, storageState: state, extraHTTPHeaders: { Origin: "https://evil.example" } });
  expect((await evil.post("/api/settings/consent", { data: { trackingConsent: true } })).status()).toBe(403);
});

test("simulated events for another employee are refused for employees", async () => {
  const liam = await session("liam@graphflow.demo");
  const emma = await idOf(`SELECT id FROM users WHERE email = 'emma@graphflow.demo'`);
  const emmaDevice = await idOf(`SELECT id FROM devices WHERE user_id = $1 LIMIT 1`, [emma]);
  const res = await liam.post("/api/simulator/runs", {
    data: { userId: emma, deviceId: emmaDevice, projectId: null, scenario: "DEEP_DESIGN", speed: 60 },
  });
  expect(res.status()).toBe(403);
});
