"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Brain, Clock, Moon, Shuffle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApi } from "@/hooks/use-api";
import { qs } from "@/lib/api/client";
import type { OverviewDTO } from "@/types/api";
import { PageHeader } from "@/components/shared/page-header";
import { DateRangeFilter, presetRange, type DateRange } from "@/components/shared/filters";
import { ErrorState, LoadingRows, EmptyState } from "@/components/shared/states";
import { KpiCard } from "@/components/shared/kpi-card";
import { CategoryBadge, RoleBadge, SimulatedBadge, TimesheetStatusBadge, ToneBadge } from "@/components/shared/badges";
import { CATEGORY_COLORS, formatDateTime, formatDuration, formatHours, formatMoney, formatPct, formatPeriod, formatTime } from "@/components/shared/format";
import { ChartCard, HorizontalBars, ToolUsageChart, TrackedBillableChart, FocusBreakdownChart } from "@/components/charts/charts";

interface EmployeeAnalytics extends OverviewDTO {
  timeline: { id: string; startedAt: string; endedAt: string; durationSeconds: number; activityCategory: string; isBillable: boolean; isContextSwitch: boolean; project: { name: string } | null; tool: { name: string } | null; file: { fileName: string } | null }[];
  deepFocusSessions: { id: string; startedAt: string; endedAt: string | null; deepFocusSeconds: number; activeSeconds: number; contextSwitchCount: number; project: { name: string } | null }[];
  timesheets: { id: string; status: string; reportingPeriodStart: string; reportingPeriodEnd: string; trackedSeconds: number; billableSeconds: number; billableAmount: string; currency: string; project: { name: string } }[];
  projectAllocation: { projectId: string | null; name: string; seconds: number }[];
}
interface Employee {
  id: string;
  displayName: string;
  email: string;
  role: string;
  title: string | null;
  isActive: boolean;
  trackingConsent: boolean;
  team: { name: string } | null;
  projectMemberships: { assignedRole: string; project: { id: string; name: string; status: string } }[];
}

export function EmployeeDetailView({ id }: { id: string }) {
  const [range, setRange] = useState<DateRange>(presetRange(14));
  const emp = useApi<Employee>(["employee", id], `/api/employees/${id}`);
  const a = useApi<EmployeeAnalytics>(["employee-analytics", id, range], `/api/employees/${id}/analytics${qs(range)}`);
  const tz = a.data?.range.timezone;

  if (emp.error) return <ErrorState message={emp.error.message} />;
  const k = a.data?.kpis;
  // Timeline: most recent day with activity.
  const lastDay = a.data?.timeline[0] ? new Date(a.data.timeline[0].startedAt).toDateString() : null;
  const dayEvents = (a.data?.timeline ?? []).filter((t) => new Date(t.startedAt).toDateString() === lastDay).reverse();
  const dayStart = dayEvents[0] ? new Date(dayEvents[0].startedAt).getTime() : 0;
  const dayEnd = dayEvents.length ? new Date(dayEvents[dayEvents.length - 1].endedAt).getTime() : 1;

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/employees">
          <ArrowLeft /> Employees
        </Link>
      </Button>
      <PageHeader
        title={emp.data?.displayName ?? "Employee"}
        description={
          emp.data && (
            <span className="flex flex-wrap items-center gap-2">
              {emp.data.title ?? "—"} · {emp.data.team?.name ?? "No team"} · <RoleBadge role={emp.data.role} />
              {!emp.data.trackingConsent && <ToneBadge tone="warning">Tracking consent not granted</ToneBadge>}
            </span>
          )
        }
        actions={
          <>
            {a.data?.isSimulatedData && <SimulatedBadge />}
            <DateRangeFilter value={range} onChange={setRange} />
          </>
        }
      />
      {a.error ? (
        <ErrorState message={a.error.message} onRetry={() => a.refetch()} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard loading={a.isLoading} label="Daily tracked (avg)" icon={Clock} tone="primary" value={k ? formatHours(k.trackedSeconds / Math.max(1, a.data!.days.filter((d) => d.trackedSeconds > 0).length)) : "—"} hint={k && `${formatHours(k.trackedSeconds)} in period`} />
            <KpiCard loading={a.isLoading} label="Deep focus" icon={Brain} tone="violet" value={k ? formatHours(k.deepFocusSeconds) : "—"} hint={k && `${formatPct(k.focusRatio)} of active time`} />
            <KpiCard loading={a.isLoading} label="Idle time" icon={Moon} tone="warning" value={k ? formatHours(k.idleSeconds) : "—"} hint="excluded from billing" />
            <KpiCard loading={a.isLoading} label="Context switches" icon={Shuffle} value={k ? k.contextSwitches : "—"} hint={k && `${k.switchesPerHour} per active hour`} />
          </div>

          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm font-medium">Focus timeline {lastDay && <span className="font-normal text-muted-foreground">· {lastDay}</span>}</CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              {a.isLoading ? (
                <LoadingRows rows={1} />
              ) : dayEvents.length === 0 ? (
                <EmptyState title="No activity in this period" />
              ) : (
                <>
                  <div className="relative h-8 w-full overflow-hidden rounded-md bg-secondary">
                    {dayEvents.map((e) => {
                      const left = ((new Date(e.startedAt).getTime() - dayStart) / (dayEnd - dayStart)) * 100;
                      const width = Math.max(0.3, (e.durationSeconds * 1000 / (dayEnd - dayStart)) * 100);
                      return (
                        <div
                          key={e.id}
                          title={`${formatTime(e.startedAt, tz)} · ${e.activityCategory} · ${e.tool?.name ?? ""} · ${formatDuration(e.durationSeconds)}`}
                          className="absolute inset-y-0"
                          style={{ left: `${left}%`, width: `${width}%`, background: CATEGORY_COLORS[e.activityCategory] }}
                        />
                      );
                    })}
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                    <span>{formatTime(new Date(dayStart), tz)}</span>
                    <span>{formatTime(new Date(dayEnd), tz)}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {Object.keys(CATEGORY_COLORS).map((c) => (
                      <CategoryBadge key={c} category={c} />
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="Daily tracked vs billable" loading={a.isLoading} empty={!!k && k.trackedSeconds === 0}>
              {a.data && <TrackedBillableChart days={a.data.days} />}
            </ChartCard>
            <ChartCard title="Focus vs interrupted work" loading={a.isLoading} empty={!!k && k.trackedSeconds === 0}>
              {a.data && <FocusBreakdownChart days={a.data.days} />}
            </ChartCard>
            <ChartCard title="Project allocation" loading={a.isLoading} empty={!!a.data && a.data.projectAllocation.length === 0}>
              {a.data && <HorizontalBars items={a.data.projectAllocation.map((p) => ({ name: p.name, value: Math.round((p.seconds / 360)) / 10 }))} />}
            </ChartCard>
            <ChartCard title="Application distribution" loading={a.isLoading} empty={!!a.data && a.data.toolUsage.length === 0}>
              {a.data && <ToolUsageChart tools={a.data.toolUsage} />}
            </ChartCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="gap-3 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-sm font-medium">Deep-focus sessions</CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                {a.data?.deepFocusSessions.length === 0 && <p className="text-xs text-muted-foreground">No deep-focus sessions in this period.</p>}
                <div className="divide-y divide-border">
                  {a.data?.deepFocusSessions.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                      <span className="text-muted-foreground">{formatDateTime(s.startedAt, tz)}</span>
                      <span className="truncate">{s.project?.name ?? "—"}</span>
                      <span className="tabular font-medium text-primary">{formatDuration(s.deepFocusSeconds)} focus</span>
                      <span className="tabular text-muted-foreground">{s.contextSwitchCount} switches</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card className="gap-3 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-sm font-medium">Timesheet history</CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                {a.data?.timesheets.length === 0 && <p className="text-xs text-muted-foreground">No timesheets yet.</p>}
                {a.data && a.data.timesheets.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Period</TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead className="text-right">Billable</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {a.data.timesheets.map((t) => (
                        <TableRow key={t.id} className="text-xs">
                          <TableCell>{formatPeriod(t.reportingPeriodStart, t.reportingPeriodEnd, tz)}</TableCell>
                          <TableCell className="max-w-[160px] truncate">{t.project.name}</TableCell>
                          <TableCell className="tabular text-right">{formatHours(t.billableSeconds, 2)}</TableCell>
                          <TableCell className="tabular text-right">{formatMoney(t.billableAmount, t.currency)}</TableCell>
                          <TableCell>
                            <TimesheetStatusBadge status={t.status} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          {emp.data && emp.data.projectMemberships.length > 0 && (
            <Card className="gap-3 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-sm font-medium">Project assignments</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 px-4">
                {emp.data.projectMemberships.map((m) => (
                  <Link key={m.project.id} href={`/projects/${m.project.id}`} className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary/40">
                    {m.project.name} <span className="text-muted-foreground">· {m.assignedRole}</span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
