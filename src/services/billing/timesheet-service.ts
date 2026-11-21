/**
 * Timesheets: generated from normalized activity, always created as DRAFT,
 * then SUBMITTED by the owner and APPROVED / REJECTED / sent back for
 * adjustment by the project manager (or an administrator). Only APPROVED
 * timesheets count towards approved billing totals. Every change to billable
 * time is preserved as an append-only BillingAdjustment and audit record.
 */
import type { Prisma, TimesheetStatus } from "@prisma/client";
import { elevateToSystem, type DbScope, type Tx } from "@/lib/db/context";
import { writeAudit } from "@/services/audit/audit-writer";
import { applyRounding, billableAmount, sumDecimalStrings } from "./billing-math";
import { DEFAULT_PROJECT_RULES, loadBillingRules } from "@/repositories/billing-config-repository";
import { addDaysToKey, localRangeToUtc } from "@/lib/utils/time";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "@/lib/api/errors";
import { can, isAdmin } from "@/lib/permissions";
import type { Paginated } from "@/lib/validation/common";

const EDITABLE: TimesheetStatus[] = ["DRAFT", "REJECTED", "ADJUSTMENT_REQUIRED"];

export const timesheetSelect = {
  id: true,
  userId: true,
  projectId: true,
  reportingPeriodStart: true,
  reportingPeriodEnd: true,
  trackedSeconds: true,
  billableSeconds: true,
  nonBillableSeconds: true,
  calculatedBillableSeconds: true,
  hourlyRate: true,
  currency: true,
  billableAmount: true,
  status: true,
  notes: true,
  submittedAt: true,
  reviewedAt: true,
  rejectionReason: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, displayName: true, email: true } },
  project: { select: { id: true, name: true, clientName: true, projectManagerId: true } },
  reviewedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.TimesheetSelect;

export interface TimesheetValues {
  trackedSeconds: number;
  billableSeconds: number;
  nonBillableSeconds: number;
}

/**
 * Tracked = non-idle seconds attributed to the project in the period.
 * Billable = classified billable seconds, rounded by the project rule and
 * never more than tracked.
 */
export async function computeTimesheetValues(
  tx: Tx,
  userId: string,
  projectId: string,
  start: Date,
  end: Date,
  roundingRule: Parameters<typeof applyRounding>[1],
): Promise<TimesheetValues> {
  const rows = await tx.focusEvent.groupBy({
    by: ["isBillable"],
    where: { userId, projectId, startedAt: { gte: start, lt: end }, activityCategory: { notIn: ["IDLE", "UNASSIGNED"] } },
    _sum: { durationSeconds: true },
  });
  const tracked = rows.reduce((s, r) => s + (r._sum.durationSeconds ?? 0), 0);
  const rawBillable = rows.find((r) => r.isBillable)?._sum.durationSeconds ?? 0;
  const billable = Math.min(tracked, applyRounding(rawBillable, roundingRule));
  return { trackedSeconds: tracked, billableSeconds: billable, nonBillableSeconds: tracked - billable };
}

export interface GenerateInput {
  periodStart: string; // YYYY-MM-DD (local, inclusive)
  periodEnd?: string; // YYYY-MM-DD (local, inclusive) — defaults to start + 6 days
  userId?: string;
  projectId?: string;
}

export async function generateTimesheets(scope: DbScope, input: GenerateInput) {
  const { tx, actor } = scope;
  const org = await tx.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { timezone: true } });
  const periodEnd = input.periodEnd ?? addDaysToKey(input.periodStart, 6);
  if (periodEnd < input.periodStart) throw badRequest("periodEnd must not be before periodStart");
  if (addDaysToKey(input.periodStart, 31) < periodEnd) throw badRequest("A timesheet period may not exceed 31 days");
  const { start, end } = localRangeToUtc(input.periodStart, periodEnd, org.timezone);

  // Who may we generate for?
  let targets: { userId: string; projectId: string }[];
  const reviewer = can(actor.role, "billing:review");
  if (!input.userId || input.userId === actor.userId) {
    if (reviewer && input.projectId && !input.userId) {
      // Manager generating for every member of a project they manage.
      const managed = await tx.project.findFirst({
        where: { id: input.projectId, ...(isAdmin(actor.role) ? {} : { projectManagerId: actor.userId }) },
        select: { id: true },
      });
      if (!managed) throw forbidden("You can only generate timesheets for projects you manage");
      const members = await tx.projectMember.findMany({ where: { projectId: input.projectId }, select: { userId: true } });
      targets = members.map((m) => ({ userId: m.userId, projectId: input.projectId! }));
    } else {
      const memberships = await tx.projectMember.findMany({
        where: { userId: actor.userId, ...(input.projectId ? { projectId: input.projectId } : {}) },
        select: { projectId: true },
      });
      targets = memberships.map((m) => ({ userId: actor.userId, projectId: m.projectId }));
    }
  } else {
    if (!reviewer) throw forbidden("You can only generate your own timesheets");
    const memberships = await tx.projectMember.findMany({
      where: {
        userId: input.userId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(isAdmin(actor.role) ? {} : { project: { projectManagerId: actor.userId } }),
      },
      select: { projectId: true },
    });
    targets = memberships.map((m) => ({ userId: input.userId!, projectId: m.projectId }));
  }

  const projectIds = [...new Set(targets.map((t) => t.projectId))];
  const projects = await tx.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, hourlyRate: true, currency: true },
  });
  const rules = await loadBillingRules(tx, projectIds);
  const summary = { created: 0, updated: 0, skipped: 0, empty: 0, timesheetIds: [] as string[] };

  for (const t of targets) {
    const project = projects.find((p) => p.id === t.projectId);
    if (!project) continue;
    const rule = rules.get(t.projectId) ?? DEFAULT_PROJECT_RULES;
    const values = await computeTimesheetValues(tx, t.userId, t.projectId, start, end, rule.roundingRule);
    const existing = await tx.timesheet.findUnique({
      where: {
        userId_projectId_reportingPeriodStart_reportingPeriodEnd: {
          userId: t.userId,
          projectId: t.projectId,
          reportingPeriodStart: start,
          reportingPeriodEnd: end,
        },
      },
      select: { id: true, status: true, billableSeconds: true, calculatedBillableSeconds: true },
    });
    if (!existing && values.trackedSeconds === 0) {
      summary.empty++;
      continue;
    }
    const rate = project.hourlyRate.toString();
    if (existing) {
      if (!EDITABLE.includes(existing.status)) {
        summary.skipped++; // submitted/approved timesheets are never silently recalculated
        continue;
      }
      await tx.timesheet.update({
        where: { id: existing.id },
        data: {
          ...values,
          calculatedBillableSeconds: values.billableSeconds,
          hourlyRate: rate,
          currency: project.currency,
          billableAmount: billableAmount(values.billableSeconds, rate),
          status: "DRAFT",
        },
      });
      if (existing.billableSeconds !== values.billableSeconds) {
        await tx.billingAdjustment.create({
          data: {
            organizationId: actor.organizationId,
            timesheetId: existing.id,
            previousBillableSeconds: existing.billableSeconds,
            adjustedBillableSeconds: values.billableSeconds,
            reason: "Recalculated from tracked activity",
            adjustedById: actor.userId,
          },
          select: { id: true },
        });
      }
      await writeAudit(scope, {
        action: "timesheet.regenerated",
        entityType: "Timesheet",
        entityId: existing.id,
        projectId: t.projectId,
        metadata: { ...values, previousBillableSeconds: existing.billableSeconds },
      });
      summary.updated++;
      summary.timesheetIds.push(existing.id);
    } else {
      const created = await tx.timesheet.create({
        data: {
          organizationId: actor.organizationId,
          userId: t.userId,
          projectId: t.projectId,
          reportingPeriodStart: start,
          reportingPeriodEnd: end,
          ...values,
          calculatedBillableSeconds: values.billableSeconds,
          hourlyRate: rate,
          currency: project.currency,
          billableAmount: billableAmount(values.billableSeconds, rate),
          status: "DRAFT",
        },
        select: { id: true },
      });
      await writeAudit(scope, {
        action: "timesheet.generated",
        entityType: "Timesheet",
        entityId: created.id,
        projectId: t.projectId,
        metadata: { ...values, periodStart: input.periodStart, periodEnd, timezone: org.timezone },
      });
      summary.created++;
      summary.timesheetIds.push(created.id);
    }
  }
  return summary;
}

async function getForUpdate(tx: Tx, id: string) {
  const ts = await tx.timesheet.findFirst({ where: { id }, select: timesheetSelect });
  if (!ts) throw notFound("Timesheet not found");
  return ts;
}

async function assertReviewer(scope: DbScope, ts: { userId: string; project: { projectManagerId: string | null } }) {
  if (ts.userId === scope.actor.userId) throw forbidden("You cannot review your own timesheet");
  if (!isAdmin(scope.actor.role) && ts.project.projectManagerId !== scope.actor.userId)
    throw forbidden("Only the project manager or an administrator can review this timesheet");
}

export async function submitTimesheet(scope: DbScope, id: string, notes?: string) {
  const { tx, actor } = scope;
  const ts = await getForUpdate(tx, id);
  if (ts.userId !== actor.userId) throw forbidden("Only the timesheet owner can submit it");
  if (!EDITABLE.includes(ts.status)) throw conflict(`A ${ts.status.toLowerCase()} timesheet cannot be submitted`);
  if (ts.trackedSeconds === 0) throw unprocessable("Cannot submit an empty timesheet");

  const rules = (await loadBillingRules(tx, [ts.projectId])).get(ts.projectId) ?? DEFAULT_PROJECT_RULES;
  const now = new Date();
  await tx.timesheet.update({
    where: { id },
    data: { status: "SUBMITTED", submittedAt: now, notes: notes ?? ts.notes, rejectionReason: null },
  });
  await writeAudit(scope, {
    action: "timesheet.submitted",
    entityType: "Timesheet",
    entityId: id,
    projectId: ts.projectId,
    metadata: { billableSeconds: ts.billableSeconds },
  });

  if (!rules.requiresApproval) {
    // Project configured without approval: auto-approve as SYSTEM (audited).
    await elevateToSystem(scope, async (sys) => {
      await sys.timesheet.update({ where: { id }, data: { status: "APPROVED", reviewedAt: new Date() } });
      await sys.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          actorId: null,
          action: "timesheet.auto_approved",
          entityType: "Timesheet",
          entityId: id,
          projectId: ts.projectId,
          metadata: { reason: "Project billing configuration does not require approval" },
          requestId: scope.requestId ?? null,
        },
      });
    });
  }
  return getForUpdate(tx, id);
}

export async function approveTimesheet(scope: DbScope, id: string, note?: string) {
  const { tx, actor } = scope;
  const ts = await getForUpdate(tx, id);
  await assertReviewer(scope, ts);
  if (ts.status !== "SUBMITTED") throw conflict("Only submitted timesheets can be approved");
  await tx.timesheet.update({
    where: { id },
    data: { status: "APPROVED", reviewedById: actor.userId, reviewedAt: new Date(), rejectionReason: null },
  });
  await writeAudit(scope, {
    action: "timesheet.approved",
    entityType: "Timesheet",
    entityId: id,
    projectId: ts.projectId,
    metadata: {
      billableSeconds: ts.billableSeconds,
      billableAmount: ts.billableAmount.toString(),
      currency: ts.currency,
      note: note ?? null,
    },
  });
  return getForUpdate(tx, id);
}

export async function rejectTimesheet(scope: DbScope, id: string, reason: string) {
  const { tx, actor } = scope;
  const ts = await getForUpdate(tx, id);
  await assertReviewer(scope, ts);
  if (ts.status !== "SUBMITTED") throw conflict("Only submitted timesheets can be rejected");
  await tx.timesheet.update({
    where: { id },
    data: { status: "REJECTED", reviewedById: actor.userId, reviewedAt: new Date(), rejectionReason: reason },
  });
  await writeAudit(scope, { action: "timesheet.rejected", entityType: "Timesheet", entityId: id, projectId: ts.projectId, metadata: { reason } });
  return getForUpdate(tx, id);
}

export async function requestAdjustment(scope: DbScope, id: string, reason: string) {
  const { tx, actor } = scope;
  const ts = await getForUpdate(tx, id);
  await assertReviewer(scope, ts);
  if (ts.status !== "SUBMITTED") throw conflict("Only submitted timesheets can be sent back for adjustment");
  await tx.timesheet.update({
    where: { id },
    data: { status: "ADJUSTMENT_REQUIRED", reviewedById: actor.userId, reviewedAt: new Date(), rejectionReason: reason },
  });
  await writeAudit(scope, {
    action: "timesheet.adjustment_requested",
    entityType: "Timesheet",
    entityId: id,
    projectId: ts.projectId,
    metadata: { reason },
  });
  return getForUpdate(tx, id);
}

/**
 * Change billable seconds. Owners may correct editable timesheets; reviewers
 * may adjust submitted ones. History is preserved in BillingAdjustment.
 */
export async function adjustTimesheet(scope: DbScope, id: string, input: { billableSeconds: number; reason: string }) {
  const { tx, actor } = scope;
  const ts = await getForUpdate(tx, id);
  const isOwner = ts.userId === actor.userId;
  if (isOwner) {
    if (!EDITABLE.includes(ts.status)) throw conflict("This timesheet can no longer be corrected by its owner");
  } else {
    await assertReviewer(scope, ts);
    if (ts.status !== "SUBMITTED") throw conflict("Reviewers can only adjust submitted timesheets");
  }
  if (input.billableSeconds > ts.trackedSeconds) throw unprocessable("Billable time cannot exceed tracked time");
  if (input.billableSeconds === ts.billableSeconds) throw unprocessable("Billable time is unchanged");

  await tx.billingAdjustment.create({
    data: {
      organizationId: actor.organizationId,
      timesheetId: id,
      previousBillableSeconds: ts.billableSeconds,
      adjustedBillableSeconds: input.billableSeconds,
      reason: input.reason,
      adjustedById: actor.userId,
    },
    select: { id: true },
  });
  await tx.timesheet.update({
    where: { id },
    data: {
      billableSeconds: input.billableSeconds,
      nonBillableSeconds: ts.trackedSeconds - input.billableSeconds,
      billableAmount: billableAmount(input.billableSeconds, ts.hourlyRate.toString()),
    },
  });
  await writeAudit(scope, {
    action: "timesheet.adjusted",
    entityType: "Timesheet",
    entityId: id,
    projectId: ts.projectId,
    metadata: { previousBillableSeconds: ts.billableSeconds, adjustedBillableSeconds: input.billableSeconds, reason: input.reason },
  });
  return getForUpdate(tx, id);
}

export async function deleteDraftTimesheet(scope: DbScope, id: string) {
  const ts = await getForUpdate(scope.tx, id);
  if (ts.status !== "DRAFT") throw conflict("Only draft timesheets can be deleted");
  if (ts.userId !== scope.actor.userId && !isAdmin(scope.actor.role)) throw forbidden();
  await scope.tx.timesheet.delete({ where: { id } });
  await writeAudit(scope, { action: "timesheet.deleted", entityType: "Timesheet", entityId: id, projectId: ts.projectId });
}

export async function getTimesheet(scope: DbScope, id: string) {
  const ts = await getForUpdate(scope.tx, id);
  const adjustments = await scope.tx.billingAdjustment.findMany({
    where: { timesheetId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      previousBillableSeconds: true,
      adjustedBillableSeconds: true,
      reason: true,
      createdAt: true,
      adjustedBy: { select: { displayName: true } },
    },
  });
  return { ...ts, adjustments };
}

export interface ListTimesheetsQuery {
  status?: TimesheetStatus;
  projectId?: string;
  userId?: string;
  page: number;
  pageSize: number;
  scope?: "all" | "mine" | "review";
}

export async function listTimesheets(scope: DbScope, q: ListTimesheetsQuery): Promise<Paginated<Prisma.TimesheetGetPayload<{ select: typeof timesheetSelect }>>> {
  const where: Prisma.TimesheetWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.projectId ? { projectId: q.projectId } : {}),
    ...(q.userId ? { userId: q.userId } : {}),
    ...(q.scope === "mine" ? { userId: scope.actor.userId } : {}),
    ...(q.scope === "review" ? { status: "SUBMITTED", userId: { not: scope.actor.userId } } : {}),
  };
  const [items, total] = await Promise.all([
    scope.tx.timesheet.findMany({
      where,
      select: timesheetSelect,
      orderBy: [{ reportingPeriodStart: "desc" }, { updatedAt: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    scope.tx.timesheet.count({ where }),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}

/** Billing totals by status and project (approved totals only from APPROVED). */
export async function billingSummary(scope: DbScope, q: { projectId?: string }) {
  const where: Prisma.TimesheetWhereInput = q.projectId ? { projectId: q.projectId } : {};
  const rows = await scope.tx.timesheet.findMany({
    where,
    select: { status: true, billableSeconds: true, trackedSeconds: true, billableAmount: true, currency: true, projectId: true, project: { select: { name: true, hourlyRate: true } } },
  });
  const byStatus = new Map<string, { count: number; billableSeconds: number; amount: string[] }>();
  const byProject = new Map<string, { projectId: string; name: string; hourlyRate: string; approvedSeconds: number; approvedAmount: string[]; pendingSeconds: number; currency: string }>();
  for (const r of rows) {
    const s = byStatus.get(r.status) ?? { count: 0, billableSeconds: 0, amount: [] };
    s.count++;
    s.billableSeconds += r.billableSeconds;
    s.amount.push(r.billableAmount.toString());
    byStatus.set(r.status, s);
    const p = byProject.get(r.projectId) ?? {
      projectId: r.projectId,
      name: r.project.name,
      hourlyRate: r.project.hourlyRate.toString(),
      approvedSeconds: 0,
      approvedAmount: [],
      pendingSeconds: 0,
      currency: r.currency,
    };
    if (r.status === "APPROVED") {
      p.approvedSeconds += r.billableSeconds;
      p.approvedAmount.push(r.billableAmount.toString());
    }
    if (r.status === "SUBMITTED") p.pendingSeconds += r.billableSeconds;
    byProject.set(r.projectId, p);
  }
  const statuses = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "ADJUSTMENT_REQUIRED"].map((status) => {
    const s = byStatus.get(status);
    return { status, count: s?.count ?? 0, billableSeconds: s?.billableSeconds ?? 0, amount: sumDecimalStrings(s?.amount ?? []) };
  });
  const approved = statuses.find((s) => s.status === "APPROVED")!;
  return {
    approvedBillableSeconds: approved.billableSeconds,
    approvedAmount: approved.amount,
    statuses,
    projects: [...byProject.values()]
      .map((p) => ({ ...p, approvedAmount: sumDecimalStrings(p.approvedAmount) }))
      .sort((a, b) => b.approvedSeconds - a.approvedSeconds),
  };
}
