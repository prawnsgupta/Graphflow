/**
 * Final acceptance workflow (Part 22), end to end against the real stack:
 * admin creates a team and project and assigns an employee; the employee runs
 * the simulator; events flow through the API, PostgreSQL, Redis/BullMQ and
 * the worker; the dashboard reflects database records; the employee generates
 * and submits a timesheet; the project manager approves it; billing totals and
 * the audit trail update.
 */
import { expect, test, type Page } from "@playwright/test";
import { db, login, logout, selectOption, waitFor } from "./helpers";

test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const teamName = `E2E Team ${stamp}`;
const projectName = `E2E Project ${stamp}`;
let projectId = "";
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});
test.afterAll(async () => {
  await page.close();
});

test("1-4. administrator creates a team and a project and assigns an employee", async () => {
  await login(page, "admin@graphflow.demo");

  // Create a team
  await page.goto("/teams");
  await page.getByRole("button", { name: "New team" }).click();
  const teamDialog = page.getByRole("dialog");
  await teamDialog.getByLabel("Team name").fill(teamName);
  await selectOption(teamDialog, "Team manager", "Priya Nair");
  await teamDialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(teamName).first()).toBeVisible();

  // Create a project in that team, managed by Olivia
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Project name").fill(projectName);
  await dialog.getByLabel("Client").fill("E2E Client Ltd");
  await selectOption(dialog, "Status", "ACTIVE");
  await dialog.getByLabel("Budget (hours)").fill("40");
  await dialog.getByLabel("Hourly rate").fill("150");
  await selectOption(dialog, "Team", teamName);
  await selectOption(dialog, "Project manager", "Olivia Park");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("link", { name: projectName }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  projectId = page.url().split("/").pop()!;

  // Assign Liam
  await page.getByRole("tab", { name: /Team/ }).click();
  await selectOption(page, "Employee to assign", "Liam Walker");
  await page.getByRole("button", { name: "Assign" }).click();
  await expect(page.getByRole("link", { name: "Liam Walker" })).toBeVisible();

  const [row] = await db<{ name: string; team: string; pm: string }>(
    `SELECT p.name, t.name AS team, u.display_name AS pm FROM projects p JOIN teams t ON t.id = p.team_id JOIN users u ON u.id = p.project_manager_id WHERE p.id = $1`,
    [projectId],
  );
  expect(row).toEqual({ name: projectName, team: teamName, pm: "Olivia Park" });
  await logout(page);
});

test("5-13. employee runs the simulator and events are processed into normalized records", async () => {
  await login(page, "liam@graphflow.demo");
  await page.goto("/simulator");
  await selectOption(page, "Project", projectName);
  await selectOption(page, "Scenario", "A · Deep design work");
  await selectOption(page, "Speed", "300x · fast demo");
  await page.getByTestId("sim-start").click();

  await expect(page.getByTestId("sim-status")).toHaveText("completed", { timeout: 120_000 });
  const generated = Number(await page.getByTestId("sim-generated").textContent());
  expect(generated).toBeGreaterThan(20);
  await expect(page.getByTestId("sim-processed")).toHaveText(String(generated), { timeout: 60_000 });
  await expect(page.getByTestId("sim-failed")).toHaveText("0");

  // 8. Raw JSONB events were persisted and processed by the worker via BullMQ
  const raw = await waitFor(
    () =>
      db<{ total: number; processed: number }>(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE processing_status = 'PROCESSED')::int AS processed
         FROM raw_activity_events WHERE payload->>'projectId' = $1::text OR session_id IN (SELECT id FROM activity_sessions WHERE project_id = $1::uuid)`,
        [projectId],
      ),
    (r) => r[0].total > 0 && r[0].total === r[0].processed,
  );
  expect(raw[0].total).toBeGreaterThanOrEqual(generated - 2);

  // 9. Normalized FocusEvents exist, deep focus detected, all simulated
  const [focus] = await db<{ n: number; seconds: number; deep: number; simulated: boolean }>(
    `SELECT count(*)::int AS n, coalesce(sum(duration_seconds),0)::int AS seconds,
            coalesce(sum(duration_seconds) FILTER (WHERE activity_category = 'DEEP_FOCUS'),0)::int AS deep,
            bool_and(is_simulated) AS simulated
     FROM focus_events WHERE project_id = $1`,
    [projectId],
  );
  expect(focus.n).toBeGreaterThan(0);
  expect(focus.seconds).toBeGreaterThan(30 * 60);
  expect(focus.deep).toBeGreaterThan(25 * 60);
  expect(focus.simulated).toBe(true);

  // 10. Dashboard metrics equal the database records
  const res = await page.request.get(`/api/projects/${projectId}/analytics`);
  expect(res.ok()).toBe(true);
  const analytics = (await res.json()).data;
  expect(analytics.kpis.trackedSeconds).toBe(focus.seconds);
  expect(analytics.kpis.deepFocusSeconds).toBe(focus.deep);
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByText("Tracked (period)")).toBeVisible();
});

test("11-12. employee generates and submits a timesheet", async () => {
  await page.goto("/billing");
  await page.getByRole("button", { name: "Generate timesheets" }).click();
  const dialog = page.getByRole("dialog");
  await selectOption(dialog, "Project", projectName);
  await dialog.getByTestId("generate-confirm").click();
  await expect(dialog).toBeHidden();

  const row = page.getByRole("row").filter({ hasText: projectName });
  await expect(row).toBeVisible();
  await expect(row.getByText("Draft")).toBeVisible();
  await row.getByRole("button", { name: "Submit" }).click();
  await expect(row.getByText("Submitted")).toBeVisible();

  const [ts] = await db<{ status: string; tracked: number; billable: number }>(
    `SELECT status, tracked_seconds AS tracked, billable_seconds AS billable FROM timesheets WHERE project_id = $1`,
    [projectId],
  );
  expect(ts.status).toBe("SUBMITTED");
  expect(ts.billable).toBeGreaterThan(0);
  await logout(page);
});

test("13-19. project manager approves and approved billing totals update", async () => {
  await login(page, "olivia.pm@graphflow.demo");
  const before = (await (await page.request.get(`/api/billing/summary?projectId=${projectId}`)).json()).data;
  expect(before.approvedBillableSeconds).toBe(0);

  await page.goto("/billing");
  const row = page.getByRole("row").filter({ hasText: projectName });
  await expect(row).toBeVisible();
  await expect(row.getByText("Liam Walker")).toBeVisible();
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Timesheet approved")).toBeVisible();

  const [ts] = await db<{ status: string; billable: number; amount: string; reviewer: string }>(
    `SELECT t.status, t.billable_seconds AS billable, t.billable_amount::text AS amount, u.display_name AS reviewer
     FROM timesheets t JOIN users u ON u.id = t.reviewed_by WHERE t.project_id = $1`,
    [projectId],
  );
  expect(ts.status).toBe("APPROVED");
  expect(ts.reviewer).toBe("Olivia Park");
  // Billable Amount = Approved Billable Hours × Project Hourly Rate (150.00)
  expect(Number(ts.amount)).toBeCloseTo((ts.billable / 3600) * 150, 2);

  const after = (await (await page.request.get(`/api/billing/summary?projectId=${projectId}`)).json()).data;
  expect(after.approvedBillableSeconds).toBe(ts.billable);
  expect(Number(after.approvedAmount)).toBeCloseTo(Number(ts.amount), 2);
});

test("20. relevant operations appear in the audit trail", async () => {
  await page.goto("/audit-logs");
  await page.getByLabel("Filter by action").fill("timesheet");
  const rows = page.getByTestId("audit-row");
  await expect(rows.filter({ hasText: "timesheet.approved" }).first()).toBeVisible();
  await expect(rows.filter({ hasText: "timesheet.submitted" }).first()).toBeVisible();

  const actions = (await db<{ action: string }>(`SELECT action FROM audit_logs WHERE project_id = $1 ORDER BY created_at`, [projectId])).map((a) => a.action);
  for (const a of ["project.created", "project.member_assigned", "simulation.started", "timesheet.generated", "timesheet.submitted", "timesheet.approved"]) {
    expect(actions).toContain(a);
  }
  await logout(page);
});
