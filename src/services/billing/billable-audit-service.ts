/**
 * BillableAudit snapshots: an immutable, point-in-time record of tracked vs
 * billable vs approved time and money for a project over a reporting period.
 * Created on demand (Billing page) and on a schedule by the worker.
 */
import { prisma } from "@/lib/db/prisma";
import { withSystem, type DbScope, type Tx } from "@/lib/db/context";
import { loadMetricEvents } from "@/repositories/focus-event-repository";
import { getOrgSettings } from "@/repositories/settings-repository";
import { computeFriction, summarize } from "@/services/analytics/metrics";
import { budgetUtilization } from "./billing-math";
import { addDaysToKey, dateKeyInTz, localRangeToUtc } from "@/lib/utils/time";
import { writeAudit } from "@/services/audit/audit-writer";
import { isAdmin } from "@/lib/permissions";

export async function computeBillableAudit(tx: Tx, organizationId: string, projectId: string, start: Date, end: Date) {
  const [project, settings, events] = await Promise.all([
    tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true, hourlyRate: true, budgetHours: true } }),
    getOrgSettings(tx, organizationId),
    loadMetricEvents(tx, { start, end, projectId }),
  ]);
  const t = summarize(events);
  const friction = computeFriction(events, settings);
  const approvedPeriod = await tx.timesheet.aggregate({
    where: { projectId, status: "APPROVED", reportingPeriodStart: { lt: end }, reportingPeriodEnd: { gt: start } },
    _sum: { billableSeconds: true, billableAmount: true },
  });
  const approvedToDate = await tx.timesheet.aggregate({
    where: { projectId, status: "APPROVED", reportingPeriodStart: { lt: end } },
    _sum: { billableSeconds: true },
  });
  const approvedSeconds = approvedPeriod._sum.billableSeconds ?? 0;
  return {
    organizationId,
    projectId,
    userId: null,
    reportingPeriodStart: start,
    reportingPeriodEnd: end,
    totalTrackedSeconds: t.trackedSeconds,
    totalDeepFocusSeconds: t.deepFocusSeconds,
    totalActiveWorkSeconds: t.activeSeconds,
    totalIdleSeconds: t.idleSeconds,
    totalFrictionSeconds: friction.totalSeconds,
    totalBillableSeconds: t.billableSeconds,
    totalNonBillableSeconds: t.nonBillableSeconds,
    approvedBillableSeconds: approvedSeconds,
    contextSwitchCount: t.contextSwitches,
    // Sum of stored per-timesheet amounts (the invoice basis).
    billableAmount: (approvedPeriod._sum.billableAmount ?? 0).toString(),
    budgetUtilizationPercentage: (budgetUtilization(approvedToDate._sum.billableSeconds ?? 0, project.budgetHours.toString()) ?? 0).toFixed(2),
  };
}

export async function runBillableAudits(scope: DbScope, input: { from: string; to: string; projectId?: string }) {
  const { tx, actor } = scope;
  const org = await tx.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { timezone: true } });
  const { start, end } = localRangeToUtc(input.from, input.to, org.timezone);
  const projects = await tx.project.findMany({
    where: {
      ...(input.projectId ? { id: input.projectId } : {}),
      ...(isAdmin(actor.role) ? {} : { projectManagerId: actor.userId }),
      status: { not: "ARCHIVED" },
    },
    select: { id: true },
  });
  const created: string[] = [];
  for (const p of projects) {
    const data = await computeBillableAudit(tx, actor.organizationId, p.id, start, end);
    const row = await tx.billableAudit.create({ data, select: { id: true } });
    created.push(row.id);
    await writeAudit(scope, {
      action: "billing.audit_calculated",
      entityType: "BillableAudit",
      entityId: row.id,
      projectId: p.id,
      metadata: { from: input.from, to: input.to, timezone: org.timezone, approvedBillableSeconds: data.approvedBillableSeconds, billableAmount: data.billableAmount },
    });
  }
  return { created: created.length, ids: created };
}

export async function listBillableAudits(scope: DbScope, q: { projectId?: string; page: number; pageSize: number }) {
  const where = q.projectId ? { projectId: q.projectId } : {};
  const [items, total] = await Promise.all([
    scope.tx.billableAudit.findMany({
      where,
      orderBy: { calculatedAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { project: { select: { name: true, currency: true } } },
    }),
    scope.tx.billableAudit.count({ where }),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}

/** Worker job: snapshot yesterday (organization timezone) for every active project. */
export async function runScheduledBillableAudits() {
  const orgs = await prisma.$queryRaw<{ id: string; timezone: string }[]>`SELECT * FROM app_list_organization_ids()`;
  let created = 0;
  for (const org of orgs) {
    const yesterday = addDaysToKey(dateKeyInTz(new Date(), org.timezone), -1);
    const { start, end } = localRangeToUtc(yesterday, yesterday, org.timezone);
    await withSystem(org.id, async (tx) => {
      const projects = await tx.project.findMany({ where: { organizationId: org.id, status: "ACTIVE" }, select: { id: true } });
      for (const p of projects) {
        const exists = await tx.billableAudit.findFirst({
          where: { projectId: p.id, reportingPeriodStart: start, reportingPeriodEnd: end, userId: null },
          select: { id: true },
        });
        if (exists) continue;
        await tx.billableAudit.create({ data: await computeBillableAudit(tx, org.id, p.id, start, end), select: { id: true } });
        created++;
      }
    });
  }
  return { created };
}
