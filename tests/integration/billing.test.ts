import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRls, type Actor, type DbScope } from "@/lib/db/context";
import { prisma } from "@/lib/db/prisma";
import { ingestEvents } from "@/services/events/ingestion-service";
import { processRawEvent } from "@/services/events/processor";
import {
  adjustTimesheet,
  approveTimesheet,
  billingSummary,
  generateTimesheets,
  rejectTimesheet,
  submitTimesheet,
} from "@/services/billing/timesheet-service";
import { dateKeyInTz, startOfWeekKey } from "@/lib/utils/time";
import { createFixture, destroyFixture, focusSession, owner, type Fixture } from "./helpers";

let f: Fixture;
const as = <T,>(actor: Actor, fn: (scope: DbScope) => Promise<T>) => withRls(actor, (tx) => fn({ tx, actor }));

beforeAll(async () => {
  f = await createFixture("billing");
  // 45 minutes of billable Figma work for empA1 on project A, earlier today.
  const u = f.users.empA1;
  const weekStart = startOfWeekKey(dateKeyInTz(new Date(), "UTC"));
  const base = Math.max(new Date(`${weekStart}T00:30:00Z`).getTime(), Date.now() - 6 * 3600_000);
  const { events } = focusSession(u, f.projects.A, 45, { base: Math.min(base, Date.now() - 50 * 60_000) });
  const res = await ingestEvents(u, u.userId, events, { source: "agent" });
  for (const r of res.results) await processRawEvent(r.rawEventId!, f.orgId);
});
afterAll(async () => {
  await destroyFixture(f);
  await owner.$disconnect();
  await prisma.$disconnect();
});

const period = () => startOfWeekKey(dateKeyInTz(new Date(), "UTC"));

describe("timesheet workflow", () => {
  let timesheetId: string;

  it("generates a DRAFT timesheet from processed activity", async () => {
    const r = await as(f.users.empA1, (s) => generateTimesheets(s, { periodStart: period(), projectId: f.projects.A }));
    expect(r.created).toBe(1);
    timesheetId = r.timesheetIds[0];
    const ts = await owner.timesheet.findUniqueOrThrow({ where: { id: timesheetId } });
    expect(ts).toMatchObject({ status: "DRAFT", trackedSeconds: 2700, billableSeconds: 2700, nonBillableSeconds: 0 });
    expect(ts.billableAmount.toString()).toBe("90"); // 0.75 h × 120.00
  });

  it("lets only the owner submit, and blocks self-approval", async () => {
    await expect(as(f.users.empA2, (s) => submitTimesheet(s, timesheetId))).rejects.toThrow();
    const submitted = await as(f.users.empA1, (s) => submitTimesheet(s, timesheetId));
    expect(submitted.status).toBe("SUBMITTED");
    await expect(as(f.users.empA1, (s) => approveTimesheet(s, timesheetId))).rejects.toThrow();
  });

  it("blocks review by a project manager of another project (app + RLS)", async () => {
    await expect(as(f.users.pmB, (s) => approveTimesheet(s, timesheetId))).rejects.toThrow();
  });

  it("enforces review rules in the database even if app checks are bypassed", async () => {
    // Direct UPDATE as the owner, through the restricted app role.
    await expect(
      withRls(f.users.empA1, (tx) => tx.timesheet.update({ where: { id: timesheetId }, data: { status: "APPROVED" } })),
    ).rejects.toThrow(/own timesheets/);
  });

  it("records adjustments with history and recalculates the amount", async () => {
    const adjusted = await as(f.users.pmA, (s) => adjustTimesheet(s, timesheetId, { billableSeconds: 1800, reason: "Exclude internal review" }));
    expect(adjusted.billableSeconds).toBe(1800);
    expect(adjusted.billableAmount.toString()).toBe("60");
    const history = await owner.billingAdjustment.findMany({ where: { timesheetId } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ previousBillableSeconds: 2700, adjustedBillableSeconds: 1800 });
  });

  it("approves as the project manager and updates approved billing totals", async () => {
    const before = await as(f.users.pmA, (s) => billingSummary(s, { projectId: f.projects.A }));
    expect(before.approvedBillableSeconds).toBe(0);
    const approved = await as(f.users.pmA, (s) => approveTimesheet(s, timesheetId, "ok"));
    expect(approved.status).toBe("APPROVED");
    const after = await as(f.users.pmA, (s) => billingSummary(s, { projectId: f.projects.A }));
    expect(after.approvedBillableSeconds).toBe(1800);
    expect(after.approvedAmount).toBe("60.00");
  });

  it("keeps approved timesheets immutable", async () => {
    await expect(as(f.users.pmA, (s) => rejectTimesheet(s, timesheetId, "too late"))).rejects.toThrow();
    await expect(withRls(f.users.pmA, (tx) => tx.timesheet.update({ where: { id: timesheetId }, data: { billableSeconds: 1 } }))).rejects.toThrow(/immutable/);
    // Regeneration never overwrites a submitted/approved timesheet.
    const r = await as(f.users.empA1, (s) => generateTimesheets(s, { periodStart: period(), projectId: f.projects.A }));
    expect(r.skipped).toBe(1);
  });

  it("writes an audit trail for every billing action", async () => {
    const actions = (await owner.auditLog.findMany({ where: { entityId: timesheetId }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["timesheet.generated", "timesheet.submitted", "timesheet.adjusted", "timesheet.approved"]);
  });

  it("makes audit records append-only for the application role", async () => {
    const log = await owner.auditLog.findFirstOrThrow({ where: { entityId: timesheetId } });
    await expect(withRls(f.users.admin, (tx) => tx.auditLog.update({ where: { id: log.id }, data: { action: "tampered" } }))).rejects.toThrow();
    await expect(withRls(f.users.admin, (tx) => tx.auditLog.delete({ where: { id: log.id } }))).rejects.toThrow();
  });
});
