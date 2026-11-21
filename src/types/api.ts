/** Client-side shapes of API responses (serialized JSON). */
import type { DayPoint } from "@/components/charts/charts";

export interface InsightDTO {
  id: string;
  category: string;
  severity: "critical" | "warning" | "info" | "positive";
  title: string;
  description: string;
  metric: { label: string; value: number; unit: string; previous?: number };
  related: { type: string; id: string | null; name: string };
  recommendation: string;
  createdAt: string;
}

export interface BudgetDTO {
  id: string;
  name: string;
  clientName: string | null;
  status: string;
  currency: string;
  hourlyRate: string;
  budgetHours: number;
  approvedBillableSeconds: number;
  pendingBillableSeconds: number;
  approvedAmount: string;
  utilizationPct: number | null;
  remainingHours: number | null;
}

export interface OverviewDTO {
  range: { from: string; to: string; timezone: string };
  isSimulatedData: boolean;
  kpis: {
    trackedSeconds: number;
    activeSeconds: number;
    idleSeconds: number;
    deepFocusSeconds: number;
    classifiedBillableSeconds: number;
    nonBillableSeconds: number;
    approvedBillableSeconds: number;
    approvedAmount: string;
    frictionSeconds: number;
    frictionRatio: number;
    focusRatio: number;
    activeProjects: number;
    contextSwitches: number;
    switchesPerHour: number;
    avgUninterruptedSeconds: number;
    billableShare: number;
  };
  friction: { idleSeconds: number; unassignedSeconds: number; excessSwitchSeconds: number; fragmentedSeconds: number; totalSeconds: number };
  days: DayPoint[];
  toolUsage: { toolId: string | null; name: string; category: string; seconds: number }[];
  budgets: BudgetDTO[];
  budgetAlerts: BudgetDTO[];
  recentActivity: {
    id: string;
    startedAt: string;
    durationSeconds: number;
    activityCategory: string;
    isBillable: boolean;
    isSimulated: boolean;
    user: { id: string; displayName: string };
    project: { id: string; name: string } | null;
    tool: { name: string } | null;
  }[];
  pendingTimesheets: {
    count: number;
    mode: "review" | "own";
    items: {
      id: string;
      status: string;
      billableSeconds: number;
      trackedSeconds: number;
      reportingPeriodStart: string;
      reportingPeriodEnd: string;
      user: { displayName: string };
      project: { name: string };
    }[];
  };
  insights: InsightDTO[];
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
