/**
 * Deterministic, rule-based insights. Every insight is derived from metrics
 * computed from database records and carries the supporting metric so it is
 * explainable and traceable. Insights describe projects, teams or the
 * organization — never judgments about an individual's performance.
 */
import { createHash } from "node:crypto";

export type InsightSeverity = "critical" | "warning" | "info" | "positive";
export type InsightCategory = "BUDGET" | "CONTEXT_SWITCHING" | "UNASSIGNED_WORK" | "FOCUS" | "TIMESHEETS" | "IDLE";

export interface Insight {
  id: string;
  category: InsightCategory;
  severity: InsightSeverity;
  title: string;
  description: string;
  metric: { label: string; value: number; unit: string; previous?: number };
  related: { type: "project" | "team" | "organization"; id: string | null; name: string };
  recommendation: string;
  createdAt: string;
}

export interface WindowMetrics {
  activeSeconds: number;
  trackedSeconds: number;
  idleSeconds: number;
  unassignedSeconds: number;
  deepFocusSeconds: number;
  contextSwitches: number;
  avgUninterruptedSeconds: number;
}

export interface InsightInput {
  scopeName: string;
  budgetAlertThresholdPct: number;
  projects: {
    id: string;
    name: string;
    budgetHours: number;
    approvedHours: number;
    pendingHours: number;
  }[];
  thisWeek: WindowMetrics;
  lastWeek: WindowMetrics;
  pendingReviewCount: number;
  canReview: boolean;
  now: Date;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function makeId(...parts: string[]) {
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

export function generateInsights(input: InsightInput): Insight[] {
  const out: Insight[] = [];
  const createdAt = input.now.toISOString();
  const week = createdAt.slice(0, 10);
  const org = { type: "organization" as const, id: null, name: input.scopeName };

  // 1. Budget consumption per project.
  for (const p of input.projects) {
    if (p.budgetHours <= 0) continue;
    const used = (p.approvedHours / p.budgetHours) * 100;
    const projected = ((p.approvedHours + p.pendingHours) / p.budgetHours) * 100;
    if (used >= 100) {
      out.push({
        id: makeId("budget-over", p.id, week),
        category: "BUDGET",
        severity: "critical",
        title: `${p.name} has exceeded its budget`,
        description: `${p.name} has consumed ${r1(used)}% of its ${p.budgetHours} allocated hours (${r1(p.approvedHours)} approved billable hours).`,
        metric: { label: "Budget used", value: r1(used), unit: "%" },
        related: { type: "project", id: p.id, name: p.name },
        recommendation: "Review scope with the client or approve a budget extension before logging more billable time.",
        createdAt,
      });
    } else if (used >= input.budgetAlertThresholdPct) {
      out.push({
        id: makeId("budget-threshold", p.id, week),
        category: "BUDGET",
        severity: "warning",
        title: `${p.name} has consumed ${Math.round(used)}% of its allocated hours`,
        description: `${r1(p.approvedHours)} of ${p.budgetHours} budgeted hours are approved and billed.`,
        metric: { label: "Budget used", value: r1(used), unit: "%" },
        related: { type: "project", id: p.id, name: p.name },
        recommendation: "Confirm the remaining scope fits the remaining hours and notify the client early if not.",
        createdAt,
      });
    } else if (projected >= 100) {
      out.push({
        id: makeId("budget-projected", p.id, week),
        category: "BUDGET",
        severity: "warning",
        title: `${p.name} will exceed its budget once pending timesheets are approved`,
        description: `Approved (${r1(p.approvedHours)} h) plus submitted (${r1(p.pendingHours)} h) hours reach ${r1(projected)}% of the ${p.budgetHours} h budget.`,
        metric: { label: "Projected budget use", value: r1(projected), unit: "%" },
        related: { type: "project", id: p.id, name: p.name },
        recommendation: "Review pending timesheets against remaining budget before approving.",
        createdAt,
      });
    }
  }

  // 2. Context switching trend (per active hour, week over week).
  const rate = (w: WindowMetrics) => (w.activeSeconds > 0 ? w.contextSwitches / (w.activeSeconds / 3600) : 0);
  const now = rate(input.thisWeek);
  const prev = rate(input.lastWeek);
  if (prev > 0 && input.thisWeek.activeSeconds >= 3600) {
    const change = ((now - prev) / prev) * 100;
    if (change >= 20) {
      out.push({
        id: makeId("switch-up", week),
        category: "CONTEXT_SWITCHING",
        severity: "warning",
        title: `Context switching increased by ${Math.round(change)}% compared with the previous week`,
        description: `Switches per active hour rose from ${r1(prev)} to ${r1(now)} across ${input.scopeName}.`,
        metric: { label: "Switches per active hour", value: r1(now), unit: "/h", previous: r1(prev) },
        related: org,
        recommendation: "Batch communication into scheduled windows and protect blocks for single-project work.",
        createdAt,
      });
    } else if (change <= -20) {
      out.push({
        id: makeId("switch-down", week),
        category: "CONTEXT_SWITCHING",
        severity: "positive",
        title: `Context switching decreased by ${Math.round(-change)}% compared with the previous week`,
        description: `Switches per active hour fell from ${r1(prev)} to ${r1(now)}.`,
        metric: { label: "Switches per active hour", value: r1(now), unit: "/h", previous: r1(prev) },
        related: org,
        recommendation: "Keep the current meeting and communication cadence.",
        createdAt,
      });
    }
  }

  // 3. Unassigned work share.
  const unassignedShare = input.thisWeek.activeSeconds > 0 ? (input.thisWeek.unassignedSeconds / input.thisWeek.activeSeconds) * 100 : 0;
  if (unassignedShare >= 15 && input.thisWeek.unassignedSeconds >= 1800) {
    out.push({
      id: makeId("unassigned", week),
      category: "UNASSIGNED_WORK",
      severity: "warning",
      title: "A significant portion of activity remains unassigned",
      description: `${r1(unassignedShare)}% of active time this week (${r1(input.thisWeek.unassignedSeconds / 3600)} h) is not linked to any project, so it cannot be billed.`,
      metric: { label: "Unassigned share", value: r1(unassignedShare), unit: "%" },
      related: org,
      recommendation: "Ask teams to select a project when starting work, or create an internal project for non-client work.",
      createdAt,
    });
  }

  // 4. Average uninterrupted session trend.
  const a = input.thisWeek.avgUninterruptedSeconds;
  const b = input.lastWeek.avgUninterruptedSeconds;
  if (b > 0 && a > 0) {
    const change = ((a - b) / b) * 100;
    if (change <= -15) {
      out.push({
        id: makeId("focus-down", week),
        category: "FOCUS",
        severity: "info",
        title: "Average uninterrupted focus session decreased this week",
        description: `Average uninterrupted session length fell from ${Math.round(b / 60)} to ${Math.round(a / 60)} minutes.`,
        metric: { label: "Avg uninterrupted session", value: Math.round(a / 60), unit: "min", previous: Math.round(b / 60) },
        related: org,
        recommendation: "Consider no-meeting focus blocks and asynchronous status updates.",
        createdAt,
      });
    }
  }

  // 5. Deep focus ratio.
  const dfr = input.thisWeek.activeSeconds > 0 ? (input.thisWeek.deepFocusSeconds / input.thisWeek.activeSeconds) * 100 : 0;
  if (input.thisWeek.activeSeconds >= 5 * 3600 && dfr < 20) {
    out.push({
      id: makeId("focus-low", week),
      category: "FOCUS",
      severity: "info",
      title: "Little active work this week reached deep-focus length",
      description: `Only ${r1(dfr)}% of active time was spent in uninterrupted sessions of the configured deep-focus length.`,
      metric: { label: "Deep focus ratio", value: r1(dfr), unit: "%" },
      related: org,
      recommendation: "Review recurring interruptions; this is a workflow signal, not an individual performance measure.",
      createdAt,
    });
  }

  // 6. Idle share.
  const idleShare = input.thisWeek.trackedSeconds > 0 ? (input.thisWeek.idleSeconds / input.thisWeek.trackedSeconds) * 100 : 0;
  if (idleShare >= 25 && input.thisWeek.idleSeconds >= 3600) {
    out.push({
      id: makeId("idle", week),
      category: "IDLE",
      severity: "info",
      title: "Idle time is a large share of tracked time",
      description: `${r1(idleShare)}% of tracked time this week was idle. Idle time is excluded from billable totals.`,
      metric: { label: "Idle share", value: r1(idleShare), unit: "%" },
      related: org,
      recommendation: "Check whether the idle timeout suits your workflows (Settings → Analytics thresholds).",
      createdAt,
    });
  }

  // 7. Timesheets awaiting approval.
  if (input.canReview && input.pendingReviewCount > 0) {
    out.push({
      id: makeId("timesheets", String(input.pendingReviewCount), week),
      category: "TIMESHEETS",
      severity: input.pendingReviewCount >= 5 ? "warning" : "info",
      title: `${input.pendingReviewCount} timesheet${input.pendingReviewCount === 1 ? " is" : "s are"} awaiting approval`,
      description: "Submitted timesheets do not count towards approved billing totals until reviewed.",
      metric: { label: "Awaiting approval", value: input.pendingReviewCount, unit: "timesheets" },
      related: org,
      recommendation: "Review submitted timesheets on the Billing page.",
      createdAt,
    });
  }

  const order: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2, positive: 3 };
  return out.sort((x, y) => order[x.severity] - order[y.severity]);
}
