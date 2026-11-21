/**
 * Reports. Every report is built inside the requester's RLS transaction, so
 * exports apply exactly the same authorization and filtering as the pages.
 * Each report states its reporting period and timezone.
 */
import type { DbScope } from "@/lib/db/context";
import { resolveRange, projectBudgets, teamAnalytics } from "@/services/analytics/analytics-service";
import { loadMetricEvents } from "@/repositories/focus-event-repository";
import { getOrgSettings } from "@/repositories/settings-repository";
import { computeFriction, deepFocusRatio, groupBy, groupByDay, summarize, switchesPerActiveHour } from "@/services/analytics/metrics";
import { pct, sumDecimalStrings } from "@/services/billing/billing-math";
import { formatDateInTz, secondsToHours } from "@/lib/utils/time";
import { forbidden, badRequest } from "@/lib/api/errors";
import { can } from "@/lib/permissions";

export const REPORT_TYPES = [
  { id: "employee-timesheet", name: "Employee timesheet", description: "Timesheets per employee and project with status and billable amounts." },
  { id: "project-billing", name: "Project billing summary", description: "Budget, approved billable hours, amounts and utilization per project." },
  { id: "team-productivity", name: "Team productivity", description: "Workload, focus, billable utilization and context switching per team." },
  { id: "organization-monthly", name: "Monthly organization report", description: "Organization-wide time, focus, friction and billing totals by day." },
  { id: "application-usage", name: "Application usage", description: "Time per application and category, split by billable status." },
  { id: "workflow-friction", name: "Workflow friction", description: "Idle, unassigned, excess switching and fragmented time per project." },
] as const;

export type ReportType = (typeof REPORT_TYPES)[number]["id"];

export interface ReportData {
  title: string;
  subtitle: string;
  generatedAt: string;
  timezone: string;
  period: { from: string; to: string };
  columns: string[];
  rows: (string | number)[][];
  summary: [string, string][];
  notes: string[];
}

const h = (s: number) => secondsToHours(s, 2);

export async function buildReport(
  scope: DbScope,
  type: ReportType,
  q: { from?: string; to?: string; projectId?: string; userId?: string; teamId?: string },
): Promise<ReportData> {
  const { tx, actor } = scope;
  if (type === "organization-monthly" && !can(actor.role, "reports:organization")) throw forbidden("Organization reports are restricted to administrators");
  const range = await resolveRange(tx, actor.organizationId, q, type === "organization-monthly" ? 30 : 14);
  const org = await tx.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { name: true, isDemo: true } });
  const base = {
    generatedAt: new Date().toISOString(),
    timezone: range.timezone,
    period: { from: range.from, to: range.to },
    subtitle: `${org.name} · ${range.from} to ${range.to} · Timezone ${range.timezone}`,
    notes: [
      "Durations are reconstructed from activity metadata only (no screenshots, keystrokes or contents).",
      "Only APPROVED timesheets count towards approved billable totals.",
      ...(org.isDemo ? ["DEMO environment: activity is SIMULATED."] : []),
    ],
  };
  const userIds = q.teamId ? (await tx.user.findMany({ where: { teamId: q.teamId }, select: { id: true } })).map((u) => u.id) : undefined;

  switch (type) {
    case "employee-timesheet": {
      const sheets = await tx.timesheet.findMany({
        where: {
          reportingPeriodStart: { lt: range.end },
          reportingPeriodEnd: { gt: range.start },
          ...(q.projectId ? { projectId: q.projectId } : {}),
          ...(q.userId ? { userId: q.userId } : userIds ? { userId: { in: userIds } } : {}),
        },
        orderBy: [{ user: { displayName: "asc" } }, { reportingPeriodStart: "asc" }],
        select: {
          reportingPeriodStart: true,
          reportingPeriodEnd: true,
          trackedSeconds: true,
          billableSeconds: true,
          nonBillableSeconds: true,
          hourlyRate: true,
          billableAmount: true,
          currency: true,
          status: true,
          user: { select: { displayName: true } },
          project: { select: { name: true } },
        },
      });
      const approved = sheets.filter((s) => s.status === "APPROVED");
      return {
        ...base,
        title: "Employee timesheet report",
        columns: ["Employee", "Project", "Period start", "Period end", "Tracked h", "Billable h", "Non-billable h", "Rate", "Amount", "Currency", "Status"],
        rows: sheets.map((s) => [
          s.user.displayName,
          s.project.name,
          formatDateInTz(s.reportingPeriodStart, range.timezone),
          formatDateInTz(new Date(s.reportingPeriodEnd.getTime() - 1), range.timezone),
          h(s.trackedSeconds),
          h(s.billableSeconds),
          h(s.nonBillableSeconds),
          s.hourlyRate.toString(),
          s.billableAmount.toString(),
          s.currency,
          s.status,
        ]),
        summary: [
          ["Timesheets", String(sheets.length)],
          ["Approved billable hours", String(h(approved.reduce((a, s) => a + s.billableSeconds, 0)))],
          ["Approved amount", sumDecimalStrings(approved.map((s) => s.billableAmount.toString()))],
        ],
      };
    }
    case "project-billing": {
      const budgets = await projectBudgets(tx, { projectId: q.projectId });
      const events = await loadMetricEvents(tx, { start: range.start, end: range.end, projectId: q.projectId });
      const perProject = groupBy(events, (e) => e.projectId ?? "none");
      return {
        ...base,
        title: "Project billing summary",
        columns: ["Project", "Client", "Status", "Budget h", "Approved billable h", "Pending h", "Remaining h", "Utilization %", "Rate", "Approved amount", "Currency", "Tracked h (period)", "Classified billable h (period)"],
        rows: budgets.map((b) => {
          const t = summarize(perProject.get(b.id) ?? []);
          return [
            b.name,
            b.clientName ?? "",
            b.status,
            b.budgetHours,
            h(b.approvedBillableSeconds),
            h(b.pendingBillableSeconds),
            b.remainingHours ?? "",
            b.utilizationPct ?? "",
            b.hourlyRate,
            b.approvedAmount,
            b.currency,
            h(t.trackedSeconds),
            h(t.billableSeconds),
          ];
        }),
        summary: [
          ["Projects", String(budgets.length)],
          ["Total approved amount", sumDecimalStrings(budgets.map((b) => b.approvedAmount))],
        ],
      };
    }
    case "team-productivity": {
      const data = await teamAnalytics(scope, { from: range.from, to: range.to, teamId: q.teamId });
      return {
        ...base,
        title: "Team productivity report",
        columns: ["Team", "Members", "Active h", "Deep focus h", "Focus ratio %", "Billable h", "Billable utilization %", "Context switches", "Switches / active h", "Active h per member"],
        rows: data.teams.map((t) => [
          t.name,
          t.memberCount,
          h(t.activeSeconds),
          h(t.deepFocusSeconds),
          t.focusRatio,
          h(t.billableSeconds),
          t.billableUtilization,
          t.contextSwitches,
          t.switchesPerHour,
          t.workloadHoursPerMember,
        ]),
        summary: [["Teams", String(data.teams.length)]],
        notes: [...base.notes, "Team metrics are aggregates and are not individual performance ratings."],
      };
    }
    case "organization-monthly": {
      const settings = await getOrgSettings(tx, actor.organizationId);
      const events = await loadMetricEvents(tx, { start: range.start, end: range.end });
      const byDay = groupByDay(events, range.timezone);
      const total = summarize(events);
      const friction = computeFriction(events, settings);
      const approved = await tx.timesheet.aggregate({
        where: { status: "APPROVED", reportingPeriodStart: { lt: range.end }, reportingPeriodEnd: { gt: range.start } },
        _sum: { billableSeconds: true },
      });
      return {
        ...base,
        title: "Monthly organization report",
        columns: ["Date", "Tracked h", "Active h", "Idle h", "Deep focus h", "Classified billable h", "Friction h", "Context switches"],
        rows: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => {
          const t = summarize(list);
          return [day, h(t.trackedSeconds), h(t.activeSeconds), h(t.idleSeconds), h(t.deepFocusSeconds), h(t.billableSeconds), h(computeFriction(list, settings).totalSeconds), t.contextSwitches];
        }),
        summary: [
          ["Tracked hours", String(h(total.trackedSeconds))],
          ["Deep focus ratio", `${deepFocusRatio(total)}%`],
          ["Friction hours", String(h(friction.totalSeconds))],
          ["Approved billable hours", String(h(approved._sum.billableSeconds ?? 0))],
        ],
      };
    }
    case "application-usage": {
      const events = await loadMetricEvents(tx, { start: range.start, end: range.end, projectId: q.projectId, userId: q.userId, userIds });
      const tools = await tx.tool.findMany({ select: { id: true, name: true, category: true } });
      const active = events.filter((e) => e.category !== "IDLE");
      const totalActive = active.reduce((s, e) => s + e.durationSeconds, 0);
      const rows = [...groupBy(active, (e) => e.toolId ?? "none").entries()]
        .map(([id, list]) => {
          const tool = tools.find((t) => t.id === id);
          const t = summarize(list);
          return [tool?.name ?? "Other / unknown", tool?.category ?? "OTHER", h(t.activeSeconds), h(t.billableSeconds), h(t.nonBillableSeconds), pct(t.activeSeconds, totalActive), t.contextSwitches] as (string | number)[];
        })
        .sort((a, b) => Number(b[2]) - Number(a[2]));
      return {
        ...base,
        title: "Application usage report",
        columns: ["Application", "Category", "Active h", "Billable h", "Non-billable h", "Share %", "Switches into app"],
        rows,
        summary: [["Active hours", String(h(totalActive))]],
      };
    }
    case "workflow-friction": {
      const settings = await getOrgSettings(tx, actor.organizationId);
      const events = await loadMetricEvents(tx, { start: range.start, end: range.end, projectId: q.projectId, userIds });
      const projects = await tx.project.findMany({ select: { id: true, name: true } });
      const rows = [...groupBy(events, (e) => e.projectId ?? "none").entries()].map(([pid, list]) => {
        const f = computeFriction(list, settings);
        const t = summarize(list);
        return [
          pid === "none" ? "Unassigned" : (projects.find((p) => p.id === pid)?.name ?? "Restricted"),
          h(t.trackedSeconds),
          h(f.idleSeconds),
          h(f.unassignedSeconds),
          h(f.excessSwitchSeconds),
          h(f.fragmentedSeconds),
          h(f.totalSeconds),
          pct(f.totalSeconds, t.trackedSeconds),
          switchesPerActiveHour(t),
        ] as (string | number)[];
      });
      const total = computeFriction(events, settings);
      return {
        ...base,
        title: "Workflow friction report",
        columns: ["Project", "Tracked h", "Idle h", "Unassigned h", "Excess switching h", "Fragmented h", "Friction h", "Friction %", "Switches / active h"],
        rows,
        summary: [["Total friction hours", String(h(total.totalSeconds))]],
        notes: [
          ...base.notes,
          `Rules: switches above ${settings.contextSwitchThresholdPerHour}/hour cost ${settings.contextSwitchCostSeconds}s each; fragments are active segments under ${settings.fragmentThresholdSeconds}s when ${settings.fragmentMinCountPerHour}+ occur in one hour. Collaboration and administrative time are not friction.`,
        ],
      };
    }
    default:
      throw badRequest("Unknown report type");
  }
}

function csvCell(v: string | number): string {
  const s = String(v);
  // Neutralise spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v === "string" ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function reportToCsv(r: ReportData): string {
  const lines = [
    `# ${r.title}`,
    `# ${r.subtitle}`,
    `# Period: ${r.period.from} to ${r.period.to} (${r.timezone}); generated ${r.generatedAt}`,
    r.columns.map(csvCell).join(","),
    ...r.rows.map((row) => row.map(csvCell).join(",")),
    "",
    ...r.summary.map(([k, v]) => `${csvCell(k)},${csvCell(v)}`),
  ];
  return lines.join("\r\n");
}
