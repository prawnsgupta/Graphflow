/**
 * Analytics service. Loads normalized records inside the caller's RLS
 * transaction (so every role automatically sees only what it may see) and
 * computes all dashboard metrics server-side.
 */
import type { DbScope, Tx } from "@/lib/db/context";
import { addDaysToKey, dateKeyInTz, eachDateKey, localRangeToUtc } from "@/lib/utils/time";
import { loadMetricEvents } from "@/repositories/focus-event-repository";
import { getOrgSettings, type OrgSettings } from "@/repositories/settings-repository";
import {
  averageUninterruptedSeconds,
  computeFriction,
  deepFocusRatio,
  frictionRatio,
  groupBy,
  groupByDay,
  summarize,
  switchesPerActiveHour,
  type MetricEvent,
} from "./metrics";
import { budgetUtilization, pct, sumDecimalStrings } from "@/services/billing/billing-math";
import { generateInsights, type Insight, type WindowMetrics } from "@/services/insights/insights-engine";
import { can } from "@/lib/permissions";
import { notFound } from "@/lib/api/errors";
import type { AnalyticsQuery } from "@/lib/validation/common";

export interface ResolvedRange {
  from: string;
  to: string;
  start: Date;
  end: Date;
  timezone: string;
}

export async function resolveRange(tx: Tx, organizationId: string, q: { from?: string; to?: string }, defaultDays = 14): Promise<ResolvedRange> {
  const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { timezone: true } });
  const today = dateKeyInTz(new Date(), org.timezone);
  const to = q.to ?? today;
  const from = q.from ?? addDaysToKey(to, -(defaultDays - 1));
  const { start, end } = localRangeToUtc(from, to, org.timezone);
  return { from, to, start, end, timezone: org.timezone };
}

async function teamUserIds(tx: Tx, teamId: string): Promise<string[]> {
  const users = await tx.user.findMany({ where: { teamId }, select: { id: true } });
  return users.map((u) => u.id);
}

export async function loadScopedEvents(tx: Tx, range: ResolvedRange, q: AnalyticsQuery): Promise<MetricEvent[]> {
  const userIds = q.teamId ? await teamUserIds(tx, q.teamId) : undefined;
  return loadMetricEvents(tx, { start: range.start, end: range.end, projectId: q.projectId, userId: q.userId, userIds });
}

function windowMetrics(events: MetricEvent[]): WindowMetrics {
  const t = summarize(events);
  return {
    activeSeconds: t.activeSeconds,
    trackedSeconds: t.trackedSeconds,
    idleSeconds: t.idleSeconds,
    unassignedSeconds: t.unassignedSeconds,
    deepFocusSeconds: t.deepFocusSeconds,
    contextSwitches: t.contextSwitches,
    avgUninterruptedSeconds: averageUninterruptedSeconds(events),
  };
}

function frictionSettings(s: OrgSettings) {
  return {
    contextSwitchThresholdPerHour: s.contextSwitchThresholdPerHour,
    contextSwitchCostSeconds: s.contextSwitchCostSeconds,
    fragmentThresholdSeconds: s.fragmentThresholdSeconds,
    fragmentMinCountPerHour: s.fragmentMinCountPerHour,
  };
}

/** Per-project budget status from approved (and submitted) timesheets. */
export async function projectBudgets(tx: Tx, filter: { projectId?: string }) {
  const projects = await tx.project.findMany({
    where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] }, ...(filter.projectId ? { id: filter.projectId } : {}) },
    select: { id: true, name: true, clientName: true, budgetHours: true, hourlyRate: true, currency: true, status: true },
    orderBy: { name: "asc" },
  });
  const ids = projects.map((p) => p.id);
  const sums = ids.length
    ? await tx.timesheet.groupBy({
        by: ["projectId", "status"],
        where: { projectId: { in: ids }, status: { in: ["APPROVED", "SUBMITTED"] } },
        _sum: { billableSeconds: true, billableAmount: true },
      })
    : [];
  return projects.map((p) => {
    const approvedRow = sums.find((s) => s.projectId === p.id && s.status === "APPROVED");
    const approved = approvedRow?._sum.billableSeconds ?? 0;
    const pending = sums.find((s) => s.projectId === p.id && s.status === "SUBMITTED")?._sum.billableSeconds ?? 0;
    const budgetHours = Number(p.budgetHours);
    return {
      id: p.id,
      name: p.name,
      clientName: p.clientName,
      status: p.status,
      currency: p.currency,
      hourlyRate: p.hourlyRate.toString(),
      budgetHours,
      approvedBillableSeconds: approved,
      pendingBillableSeconds: pending,
      // Sum of stored (per-timesheet) amounts: approved timesheets are the invoice basis.
      approvedAmount: sumDecimalStrings([approvedRow?._sum.billableAmount?.toString() ?? "0"]),
      utilizationPct: budgetUtilization(approved, p.budgetHours.toString()),
      remainingHours: budgetHours > 0 ? Math.round((budgetHours - approved / 3600) * 100) / 100 : null,
    };
  });
}

export async function overview(scope: DbScope, q: AnalyticsQuery) {
  const { tx, actor } = scope;
  const [range, settings] = await Promise.all([resolveRange(tx, actor.organizationId, q), getOrgSettings(tx, actor.organizationId)]);
  const events = await loadScopedEvents(tx, range, q);
  const totals = summarize(events);
  const friction = computeFriction(events, frictionSettings(settings));

  // Approved billing (only APPROVED timesheets count towards approved totals).
  const userIds = q.teamId ? await teamUserIds(tx, q.teamId) : undefined;
  const tsWhere = {
    reportingPeriodStart: { lt: range.end },
    reportingPeriodEnd: { gt: range.start },
    ...(q.projectId ? { projectId: q.projectId } : {}),
    ...(q.userId ? { userId: q.userId } : userIds ? { userId: { in: userIds } } : {}),
  };
  const approvedSheets = await tx.timesheet.findMany({
    where: { ...tsWhere, status: "APPROVED" },
    select: { billableSeconds: true, billableAmount: true },
  });
  const approvedBillableSeconds = approvedSheets.reduce((s, t) => s + t.billableSeconds, 0);
  const approvedAmount = sumDecimalStrings(approvedSheets.map((t) => t.billableAmount.toString()));

  // Daily series in the organization's timezone.
  const byDay = groupByDay(events, range.timezone);
  const days = eachDateKey(range.from, range.to).map((day) => {
    const list = byDay.get(day) ?? [];
    const t = summarize(list);
    const f = computeFriction(list, frictionSettings(settings));
    return {
      date: day,
      trackedSeconds: t.trackedSeconds,
      activeSeconds: t.activeSeconds,
      billableSeconds: t.billableSeconds,
      deepFocusSeconds: t.deepFocusSeconds,
      activeWorkSeconds: t.activeWorkSeconds,
      collaborationSeconds: t.collaborationSeconds,
      administrativeSeconds: t.administrativeSeconds,
      idleSeconds: t.idleSeconds,
      frictionSeconds: f.totalSeconds,
      contextSwitches: t.contextSwitches,
      switchesPerHour: switchesPerActiveHour(t),
      focusRatio: deepFocusRatio(t),
    };
  });

  // Application usage.
  const toolIds = [...new Set(events.map((e) => e.toolId).filter((x): x is string => !!x))];
  const tools = await tx.tool.findMany({ where: { id: { in: toolIds } }, select: { id: true, name: true, category: true } });
  const toolUsage = [...groupBy(events.filter((e) => e.category !== "IDLE"), (e) => e.toolId ?? "none").entries()]
    .map(([toolId, list]) => {
      const tool = tools.find((t) => t.id === toolId);
      return {
        toolId: toolId === "none" ? null : toolId,
        name: tool?.name ?? "Other / unknown",
        category: tool?.category ?? "OTHER",
        seconds: list.reduce((s, e) => s + e.durationSeconds, 0),
      };
    })
    .sort((a, b) => b.seconds - a.seconds);

  const budgets = await projectBudgets(tx, { projectId: q.projectId });
  const activeProjects = await tx.project.count({ where: { status: "ACTIVE", ...(q.projectId ? { id: q.projectId } : {}) } });

  const recent = await tx.focusEvent.findMany({
    where: {
      ...(q.projectId ? { projectId: q.projectId } : {}),
      ...(q.userId ? { userId: q.userId } : userIds ? { userId: { in: userIds } } : {}),
    },
    orderBy: { startedAt: "desc" },
    take: 8,
    select: {
      id: true,
      startedAt: true,
      durationSeconds: true,
      activityCategory: true,
      isBillable: true,
      isSimulated: true,
      user: { select: { id: true, displayName: true } },
      project: { select: { id: true, name: true } },
      tool: { select: { name: true } },
    },
  });

  const reviewer = can(actor.role, "billing:review");
  const pendingWhere = reviewer
    ? { status: "SUBMITTED" as const, userId: { not: actor.userId } }
    : { userId: actor.userId, status: { in: ["DRAFT", "SUBMITTED", "REJECTED", "ADJUSTMENT_REQUIRED"] as ("DRAFT" | "SUBMITTED" | "REJECTED" | "ADJUSTMENT_REQUIRED")[] } };
  const [pendingCount, pendingList] = await Promise.all([
    tx.timesheet.count({ where: pendingWhere }),
    tx.timesheet.findMany({
      where: pendingWhere,
      orderBy: [{ submittedAt: "desc" }, { updatedAt: "desc" }],
      take: 6,
      select: {
        id: true,
        status: true,
        billableSeconds: true,
        trackedSeconds: true,
        reportingPeriodStart: true,
        reportingPeriodEnd: true,
        user: { select: { displayName: true } },
        project: { select: { name: true } },
      },
    }),
  ]);

  const budgetAlerts = budgets.filter((b) => b.utilizationPct !== null && b.utilizationPct >= settings.budgetAlertThresholdPct);
  const insights = await insightsFor(scope, settings, budgets, q);

  return {
    range,
    isSimulatedData: events.length > 0,
    kpis: {
      trackedSeconds: totals.trackedSeconds,
      activeSeconds: totals.activeSeconds,
      idleSeconds: totals.idleSeconds,
      deepFocusSeconds: totals.deepFocusSeconds,
      classifiedBillableSeconds: totals.billableSeconds,
      nonBillableSeconds: totals.nonBillableSeconds,
      approvedBillableSeconds,
      approvedAmount,
      frictionSeconds: friction.totalSeconds,
      frictionRatio: frictionRatio(friction.totalSeconds, totals),
      focusRatio: deepFocusRatio(totals),
      activeProjects,
      contextSwitches: totals.contextSwitches,
      switchesPerHour: switchesPerActiveHour(totals),
      avgUninterruptedSeconds: averageUninterruptedSeconds(events),
      billableShare: pct(totals.billableSeconds, totals.activeSeconds),
    },
    friction,
    days,
    toolUsage,
    budgets,
    budgetAlerts,
    recentActivity: recent,
    pendingTimesheets: { count: pendingCount, items: pendingList, mode: reviewer ? "review" : "own" },
    insights,
  };
}

async function insightsFor(
  scope: DbScope,
  settings: OrgSettings,
  budgets: Awaited<ReturnType<typeof projectBudgets>>,
  q: AnalyticsQuery,
): Promise<Insight[]> {
  const { tx, actor } = scope;
  const org = await tx.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { name: true, timezone: true } });
  const today = dateKeyInTz(new Date(), org.timezone);
  const thisWeek = localRangeToUtc(addDaysToKey(today, -6), today, org.timezone);
  const lastWeek = localRangeToUtc(addDaysToKey(today, -13), addDaysToKey(today, -7), org.timezone);
  const userIds = q.teamId ? await teamUserIds(tx, q.teamId) : undefined;
  const base = { projectId: q.projectId, userId: q.userId, userIds };
  const [cur, prev] = await Promise.all([
    loadMetricEvents(tx, { start: thisWeek.start, end: thisWeek.end, ...base }),
    loadMetricEvents(tx, { start: lastWeek.start, end: lastWeek.end, ...base }),
  ]);
  const reviewer = can(actor.role, "billing:review");
  const pendingReviewCount = reviewer ? await tx.timesheet.count({ where: { status: "SUBMITTED", userId: { not: actor.userId } } }) : 0;
  return generateInsights({
    scopeName: org.name,
    budgetAlertThresholdPct: settings.budgetAlertThresholdPct,
    projects: budgets.map((b) => ({
      id: b.id,
      name: b.name,
      budgetHours: b.budgetHours,
      approvedHours: b.approvedBillableSeconds / 3600,
      pendingHours: b.pendingBillableSeconds / 3600,
    })),
    thisWeek: windowMetrics(cur),
    lastWeek: windowMetrics(prev),
    pendingReviewCount,
    canReview: reviewer,
    now: new Date(),
  });
}

/** Employee detail analytics (server enforces visibility through RLS). */
export async function employeeAnalytics(scope: DbScope, userId: string, q: AnalyticsQuery) {
  const { tx } = scope;
  const user = await tx.user.findFirst({ where: { id: userId }, select: { id: true } });
  if (!user) throw notFound("Employee not found");
  const base = await overview(scope, { ...q, userId, projectId: q.projectId, teamId: undefined });
  const range = base.range;

  const timelineDay = range.to;
  const tl = localRangeToUtc(timelineDay, timelineDay, range.timezone);
  const [timeline, sessions, timesheets, projectAlloc] = await Promise.all([
    tx.focusEvent.findMany({
      where: { userId, startedAt: { gte: addHours(range.start, 0), lt: range.end } },
      orderBy: { startedAt: "desc" },
      take: 300,
      select: {
        id: true,
        startedAt: true,
        endedAt: true,
        durationSeconds: true,
        activityCategory: true,
        isBillable: true,
        isContextSwitch: true,
        project: { select: { id: true, name: true } },
        tool: { select: { name: true } },
        file: { select: { fileName: true } },
      },
    }),
    tx.activitySession.findMany({
      where: { userId, startedAt: { gte: range.start, lt: range.end }, deepFocusSeconds: { gt: 0 } },
      orderBy: { startedAt: "desc" },
      take: 20,
      select: {
        id: true,
        startedAt: true,
        endedAt: true,
        deepFocusSeconds: true,
        activeSeconds: true,
        contextSwitchCount: true,
        project: { select: { name: true } },
      },
    }),
    tx.timesheet.findMany({
      where: { userId },
      orderBy: { reportingPeriodStart: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        reportingPeriodStart: true,
        reportingPeriodEnd: true,
        trackedSeconds: true,
        billableSeconds: true,
        billableAmount: true,
        currency: true,
        project: { select: { name: true } },
      },
    }),
    tx.focusEvent.groupBy({
      by: ["projectId"],
      where: { userId, startedAt: { gte: range.start, lt: range.end }, activityCategory: { not: "IDLE" } },
      _sum: { durationSeconds: true },
    }),
  ]);
  const projectNames = await tx.project.findMany({
    where: { id: { in: projectAlloc.map((p) => p.projectId).filter((x): x is string => !!x) } },
    select: { id: true, name: true },
  });
  return {
    ...base,
    timelineDay,
    timelineWindow: tl,
    timeline,
    deepFocusSessions: sessions,
    timesheets,
    projectAllocation: projectAlloc
      .map((p) => ({
        projectId: p.projectId,
        name: p.projectId ? (projectNames.find((n) => n.id === p.projectId)?.name ?? "Restricted project") : "Unassigned",
        seconds: p._sum.durationSeconds ?? 0,
      }))
      .sort((a, b) => b.seconds - a.seconds),
  };
}

function addHours(d: Date, h: number) {
  return new Date(d.getTime() + h * 3600_000);
}

/** Team analytics: workload, focus, utilization, allocation, switching, collaboration. */
export async function teamAnalytics(scope: DbScope, q: AnalyticsQuery) {
  const { tx, actor } = scope;
  const range = await resolveRange(tx, actor.organizationId, q);
  const teamWhere =
    actor.role === "TEAM_LEAD" ? { id: actor.teamId ?? "00000000-0000-0000-0000-000000000000" } : q.teamId ? { id: q.teamId } : {};
  const teams = await tx.team.findMany({
    where: teamWhere,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      manager: { select: { id: true, displayName: true } },
      members: { where: { isActive: true }, select: { id: true, displayName: true, role: true } },
    },
  });
  const allUserIds = teams.flatMap((t) => t.members.map((m) => m.id));
  const events = await loadMetricEvents(tx, { start: range.start, end: range.end, userIds: allUserIds });
  const projects = await tx.project.findMany({ select: { id: true, name: true } });
  const links = await tx.collaborationLink.findMany({
    where: { startedAt: { gte: range.start, lt: range.end }, OR: [{ sourceUserId: { in: allUserIds } }, { targetUserId: { in: allUserIds } }] },
    select: {
      sourceUserId: true,
      targetUserId: true,
      durationSeconds: true,
      projectId: true,
      sourceUser: { select: { displayName: true } },
      targetUser: { select: { displayName: true } },
    },
  });

  return {
    range,
    teams: teams.map((team) => {
      const ids = new Set(team.members.map((m) => m.id));
      const list = events.filter((e) => ids.has(e.userId));
      const t = summarize(list);
      const allocation = [...groupBy(list.filter((e) => e.category !== "IDLE"), (e) => e.projectId ?? "unassigned").entries()]
        .map(([pid, l]) => ({
          projectId: pid === "unassigned" ? null : pid,
          name: pid === "unassigned" ? "Unassigned" : (projects.find((p) => p.id === pid)?.name ?? "Restricted project"),
          seconds: l.reduce((s, e) => s + e.durationSeconds, 0),
        }))
        .sort((a, b) => b.seconds - a.seconds);
      const memberRows = team.members.map((m) => {
        const mt = summarize(list.filter((e) => e.userId === m.id));
        return {
          ...m,
          activeSeconds: mt.activeSeconds,
          deepFocusSeconds: mt.deepFocusSeconds,
          billableSeconds: mt.billableSeconds,
          contextSwitches: mt.contextSwitches,
        };
      });
      const pairMap = new Map<string, { a: string; b: string; seconds: number; count: number }>();
      for (const l of links) {
        if (!ids.has(l.sourceUserId) && !ids.has(l.targetUserId)) continue;
        const [a, b] = [l.sourceUser.displayName, l.targetUser.displayName].sort();
        const key = `${a}|${b}`;
        const cur = pairMap.get(key) ?? { a, b, seconds: 0, count: 0 };
        cur.seconds += l.durationSeconds;
        cur.count += 1;
        pairMap.set(key, cur);
      }
      return {
        id: team.id,
        name: team.name,
        description: team.description,
        manager: team.manager,
        memberCount: team.members.length,
        trackedSeconds: t.trackedSeconds,
        activeSeconds: t.activeSeconds,
        deepFocusSeconds: t.deepFocusSeconds,
        billableSeconds: t.billableSeconds,
        billableUtilization: pct(t.billableSeconds, t.activeSeconds),
        focusRatio: deepFocusRatio(t),
        contextSwitches: t.contextSwitches,
        switchesPerHour: switchesPerActiveHour(t),
        workloadHoursPerMember: team.members.length ? Math.round((t.activeSeconds / 3600 / team.members.length) * 10) / 10 : 0,
        allocation,
        members: memberRows,
        collaboration: [...pairMap.values()].sort((x, y) => y.seconds - x.seconds).slice(0, 10),
      };
    }),
  };
}
