"use client";

import Link from "next/link";
import { useState } from "react";
import { Activity, AlarmClock, Brain, Clock, DollarSign, FolderKanban, Gauge, RefreshCw, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useApi } from "@/hooks/use-api";
import { qs } from "@/lib/api/client";
import type { OverviewDTO } from "@/types/api";
import { KpiCard } from "@/components/shared/kpi-card";
import { PageHeader } from "@/components/shared/page-header";
import { DateRangeFilter, presetRange, type DateRange } from "@/components/shared/filters";
import { ErrorState, EmptyState } from "@/components/shared/states";
import { CategoryBadge, SimulatedBadge, TimesheetStatusBadge } from "@/components/shared/badges";
import { formatDateTime, formatDuration, formatHours, formatMoney, formatPct, formatPeriod } from "@/components/shared/format";
import {
  BudgetChart,
  ChartCard,
  FocusBreakdownChart,
  ProductivityTrendChart,
  SwitchTrendChart,
  ToolUsageChart,
  TrackedBillableChart,
} from "@/components/charts/charts";
import { InsightsList } from "./insights-list";

export function OverviewView({ title = "Overview", description, filter = {} }: { title?: string; description?: string; filter?: Record<string, string | undefined> }) {
  const [range, setRange] = useState<DateRange>(presetRange(14));
  const url = `/api/analytics/overview${qs({ ...range, ...filter })}`;
  const { data, isLoading, error, refetch, isFetching } = useApi<OverviewDTO>(["overview", range, filter], url);
  const k = data?.kpis;
  const tz = data?.range.timezone;
  const noData = !!data && data.kpis.trackedSeconds === 0;

  return (
    <div>
      <PageHeader
        title={title}
        description={description ?? (tz ? `All metrics are calculated server-side from recorded activity. Reporting timezone: ${tz}.` : undefined)}
        actions={
          <>
            {data?.isSimulatedData && <SimulatedBadge />}
            <DateRangeFilter value={range} onChange={setRange} />
            <Button variant="outline" size="icon" onClick={() => refetch()} aria-label="Refresh" disabled={isFetching}>
              <RefreshCw className={isFetching ? "animate-spin" : ""} />
            </Button>
          </>
        }
      />
      {error ? (
        <ErrorState message={error.message} onRetry={() => refetch()} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard loading={isLoading} label="Total tracked" icon={Clock} tone="primary" value={k ? formatHours(k.trackedSeconds) : "—"} hint={k && `${formatHours(k.idleSeconds)} idle`} info="All reconstructed activity intervals, including idle time." />
            <KpiCard loading={isLoading} label="Billable (approved)" icon={DollarSign} tone="success" value={k ? formatHours(k.approvedBillableSeconds) : "—"} hint={k && `${formatHours(k.classifiedBillableSeconds)} classified · ${formatMoney(k.approvedAmount)}`} info="Only APPROVED timesheets count as approved billable hours. 'Classified' is billable activity not yet necessarily approved." />
            <KpiCard loading={isLoading} label="Deep focus" icon={Brain} tone="violet" value={k ? formatHours(k.deepFocusSeconds) : "—"} hint={k && `${formatDuration(k.avgUninterruptedSeconds)} avg session`} info="Uninterrupted active work on one project and tool for at least the configured threshold (default 25 min)." />
            <KpiCard loading={isLoading} label="Workflow friction" icon={AlarmClock} tone="warning" value={k ? formatHours(k.frictionSeconds) : "—"} hint={k && `${formatPct(k.frictionRatio)} of tracked`} info="Idle + unassigned time + excess context-switch cost + repeated fragmented sessions." />
            <KpiCard loading={isLoading} label="Avg focus ratio" icon={Gauge} tone="primary" value={k ? formatPct(k.focusRatio) : "—"} hint={k && `${k.switchesPerHour} switches / active h`} info="Deep Focus Seconds / Active Work Seconds × 100." />
            <KpiCard loading={isLoading} label="Active projects" icon={FolderKanban} value={k ? k.activeProjects : "—"} hint={k && `${data!.budgetAlerts.length} budget alert${data!.budgetAlerts.length === 1 ? "" : "s"}`} />
          </div>

          {noData && (
            <EmptyState
              icon={Activity}
              title="No activity recorded in this period"
              description="Open the simulator to generate activity through the event pipeline, or choose a wider date range."
              action={
                <Button asChild size="sm">
                  <Link href="/simulator">Open simulator</Link>
                </Button>
              }
            />
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="Tracked vs billable hours" description="Daily, classified billable activity" loading={isLoading} empty={noData}>
              {data && <TrackedBillableChart days={data.days} />}
            </ChartCard>
            <ChartCard title="Deep focus vs interrupted work" description="Active time by category per day" loading={isLoading} empty={noData}>
              {data && <FocusBreakdownChart days={data.days} />}
            </ChartCard>
            <ChartCard title="Application usage" description="Active time per tool" loading={isLoading} empty={!!data && data.toolUsage.length === 0}>
              {data && <ToolUsageChart tools={data.toolUsage} />}
            </ChartCard>
            <ChartCard title="Project budget utilization" description="Approved and pending billable hours vs budget" loading={isLoading} empty={!!data && data.budgets.filter((b) => b.budgetHours > 0).length === 0}>
              {data && <BudgetChart budgets={data.budgets} />}
            </ChartCard>
            <ChartCard title="Context-switching trend" description="Switches per day and per active hour" loading={isLoading} empty={noData}>
              {data && <SwitchTrendChart days={data.days} />}
            </ChartCard>
            <ChartCard title="Daily productivity trend" description="Active hours, friction and focus ratio" loading={isLoading} empty={noData}>
              {data && <ProductivityTrendChart days={data.days} />}
            </ChartCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="gap-3 py-4 xl:col-span-2">
              <CardHeader className="px-4">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <Zap className="size-4 text-primary" /> Workflow insights
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">{data ? <InsightsList insights={data.insights} limit={6} /> : <div className="h-40 animate-pulse rounded bg-secondary/40" />}</CardContent>
            </Card>
            <div className="space-y-4">
              <Card className="gap-3 py-4">
                <CardHeader className="flex flex-row items-center justify-between px-4">
                  <CardTitle className="text-sm font-medium">{data?.pendingTimesheets.mode === "review" ? "Awaiting your review" : "Your open timesheets"}</CardTitle>
                  <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
                    <Link href="/billing">View all</Link>
                  </Button>
                </CardHeader>
                <CardContent className="space-y-2 px-4">
                  {data?.pendingTimesheets.items.length === 0 && <p className="text-xs text-muted-foreground">Nothing pending.</p>}
                  {data?.pendingTimesheets.items.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-2 rounded-md bg-surface-2/40 px-2.5 py-2 text-xs">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{t.project.name}</p>
                        <p className="text-muted-foreground">
                          {t.user.displayName} · {formatPeriod(t.reportingPeriodStart, t.reportingPeriodEnd, tz)} · {formatHours(t.billableSeconds)}
                        </p>
                      </div>
                      <TimesheetStatusBadge status={t.status} />
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card className="gap-3 py-4">
                <CardHeader className="px-4">
                  <CardTitle className="text-sm font-medium">Budget alerts</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 px-4">
                  {data?.budgetAlerts.length === 0 && <p className="text-xs text-muted-foreground">All projects are within the alert threshold.</p>}
                  {data?.budgetAlerts.map((b) => (
                    <Link key={b.id} href={`/projects/${b.id}`} className="block text-xs">
                      <div className="mb-1 flex justify-between">
                        <span className="font-medium">{b.name}</span>
                        <span className={(b.utilizationPct ?? 0) >= 100 ? "text-destructive" : "text-warning"}>{formatPct(b.utilizationPct)}</span>
                      </div>
                      <Progress value={Math.min(100, b.utilizationPct ?? 0)} className="h-1.5" />
                    </Link>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>

          <Card className="gap-3 py-4">
            <CardHeader className="flex flex-row items-center justify-between px-4">
              <CardTitle className="text-sm font-medium">Recent activity</CardTitle>
              <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
                <Link href="/activity">Activity explorer</Link>
              </Button>
            </CardHeader>
            <CardContent className="px-4">
              {data?.recentActivity.length === 0 && <p className="text-xs text-muted-foreground">No activity yet.</p>}
              <div className="divide-y divide-border">
                {data?.recentActivity.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-xs">
                    <span className="w-28 text-muted-foreground">{formatDateTime(a.startedAt, tz)}</span>
                    <span className="w-32 truncate font-medium">{a.user.displayName}</span>
                    <CategoryBadge category={a.activityCategory} />
                    <span className="text-muted-foreground">{a.tool?.name ?? "—"}</span>
                    <span className="truncate text-muted-foreground">{a.project?.name ?? "Unassigned"}</span>
                    <span className="tabular ml-auto">{formatDuration(a.durationSeconds)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
