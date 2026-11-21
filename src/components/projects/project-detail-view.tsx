"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Pencil, Plus, UserMinus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApi, useApiMutation } from "@/hooks/use-api";
import { qs } from "@/lib/api/client";
import type { OverviewDTO, Page } from "@/types/api";
import { PageHeader } from "@/components/shared/page-header";
import { DateRangeFilter, presetRange, type DateRange } from "@/components/shared/filters";
import { ErrorState, LoadingRows, Spinner } from "@/components/shared/states";
import { KpiCard } from "@/components/shared/kpi-card";
import { ProjectStatusBadge, RoleBadge, TimesheetStatusBadge } from "@/components/shared/badges";
import { formatDate, formatDateTime, formatHours, formatMoney, formatPct, formatPeriod } from "@/components/shared/format";
import { ChartCard, FocusBreakdownChart, HorizontalBars, ToolUsageChart, TrackedBillableChart } from "@/components/charts/charts";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ProjectFormDialog, type ProjectFormInitial } from "./project-form-dialog";
import { InsightsList } from "@/components/dashboard/insights-list";

interface ProjectDetail extends ProjectFormInitial {
  team: { id: string; name: string } | null;
  projectManager: { id: string; displayName: string } | null;
  canManage: boolean;
  members: { id: string; assignedRole: string; assignedAt: string; user: { id: string; displayName: string; email: string; role: string; isActive: boolean } }[];
  billingConfig: {
    billableCategories: string[];
    collaborationBillable: boolean;
    administrativeBillable: boolean;
    billableToolIds: string[];
    nonBillableToolIds: string[];
    roundingRule: string;
    requiresApproval: boolean;
  };
}

export function ProjectDetailView({ id, isAdmin }: { id: string; isAdmin: boolean }) {
  const [range, setRange] = useState<DateRange>(presetRange(30));
  const [editing, setEditing] = useState(false);
  const project = useApi<ProjectDetail>(["project", id], `/api/projects/${id}`);
  const analytics = useApi<OverviewDTO>(["project-analytics", id, range], `/api/projects/${id}/analytics${qs(range)}`);
  const timesheets = useApi<Page<{ id: string; status: string; reportingPeriodStart: string; reportingPeriodEnd: string; trackedSeconds: number; billableSeconds: number; billableAmount: string; currency: string; user: { displayName: string } }>>(
    ["project-timesheets", id],
    `/api/timesheets${qs({ projectId: id, pageSize: 50 })}`,
  );
  const audit = useApi<{ id: string; action: string; createdAt: string; metadata: Record<string, unknown>; actor: { displayName: string } | null }[]>(["project-audit", id], `/api/projects/${id}/audit`);

  if (project.error) return <ErrorState message={project.error.message} />;
  const p = project.data;
  const budget = analytics.data?.budgets.find((b) => b.id === id);
  const tz = analytics.data?.range.timezone;
  const k = analytics.data?.kpis;

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/projects">
          <ArrowLeft /> Projects
        </Link>
      </Button>
      <PageHeader
        title={p?.name ?? "Project"}
        description={p && <span className="flex flex-wrap items-center gap-2">{p.clientName ?? "Internal"} · {p.team?.name ?? "No team"} · PM {p.projectManager?.displayName ?? "unassigned"} <ProjectStatusBadge status={p.status} /></span>}
        actions={
          <>
            <DateRangeFilter value={range} onChange={setRange} />
            {p?.canManage && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            )}
          </>
        }
      />
      {!p ? (
        <LoadingRows rows={6} />
      ) : (
        <Tabs defaultValue="overview">
          <TabsList className="mb-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="team">Team ({p.members.length})</TabsTrigger>
            <TabsTrigger value="billing">Billing rules</TabsTrigger>
            <TabsTrigger value="timesheets">Timesheets</TabsTrigger>
            <TabsTrigger value="audit">Audit history</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <KpiCard loading={analytics.isLoading} label="Budget" value={`${Number(p.budgetHours)} h`} hint={`${formatMoney(p.hourlyRate, p.currency)}/h`} />
              <KpiCard loading={analytics.isLoading} label="Approved billable" tone="success" value={budget ? formatHours(budget.approvedBillableSeconds) : "—"} hint={budget && formatMoney(budget.approvedAmount, p.currency)} />
              <KpiCard loading={analytics.isLoading} label="Remaining hours" tone={budget?.remainingHours !== null && (budget?.remainingHours ?? 1) < 0 ? "danger" : "primary"} value={budget?.remainingHours ?? "—"} hint={budget ? `${formatHours(budget.pendingBillableSeconds)} pending approval` : undefined} />
              <KpiCard loading={analytics.isLoading} label="Tracked (period)" value={k ? formatHours(k.trackedSeconds) : "—"} hint={k && `${formatHours(k.classifiedBillableSeconds)} classified billable`} />
              <KpiCard loading={analytics.isLoading} label="Workflow friction" tone="warning" value={k ? formatHours(k.frictionSeconds) : "—"} hint={k && `${formatPct(k.frictionRatio)} of tracked`} />
            </div>
            {budget && budget.budgetHours > 0 && (
              <Card className="gap-2 py-4">
                <CardContent className="px-4">
                  <div className="mb-2 flex justify-between text-xs">
                    <span className="text-muted-foreground">Budget utilization (approved)</span>
                    <span className={(budget.utilizationPct ?? 0) >= 100 ? "text-destructive" : (budget.utilizationPct ?? 0) >= 80 ? "text-warning" : ""}>{formatPct(budget.utilizationPct)}</span>
                  </div>
                  <Progress value={Math.min(100, budget.utilizationPct ?? 0)} />
                </CardContent>
              </Card>
            )}
            <div className="grid gap-4 xl:grid-cols-2">
              <ChartCard title="Tracked vs billable" loading={analytics.isLoading} empty={!!k && k.trackedSeconds === 0}>
                {analytics.data && <TrackedBillableChart days={analytics.data.days} />}
              </ChartCard>
              <ChartCard title="Focus trends" loading={analytics.isLoading} empty={!!k && k.trackedSeconds === 0}>
                {analytics.data && <FocusBreakdownChart days={analytics.data.days} />}
              </ChartCard>
              <ChartCard title="Tool usage" loading={analytics.isLoading} empty={!!analytics.data && analytics.data.toolUsage.length === 0}>
                {analytics.data && <ToolUsageChart tools={analytics.data.toolUsage} />}
              </ChartCard>
              <ChartCard title="Workflow friction breakdown" description="Transparent, configurable rules (Settings → Analytics)" loading={analytics.isLoading} empty={!!k && k.trackedSeconds === 0}>
                {analytics.data && (
                  <HorizontalBars
                    items={[
                      { name: "Idle time", value: analytics.data.friction.idleSeconds / 3600 },
                      { name: "Unassigned time", value: analytics.data.friction.unassignedSeconds / 3600 },
                      { name: "Excess context-switch cost", value: analytics.data.friction.excessSwitchSeconds / 3600 },
                      { name: "Repeated fragmented sessions", value: analytics.data.friction.fragmentedSeconds / 3600 },
                    ]}
                  />
                )}
              </ChartCard>
            </div>
            {analytics.data && analytics.data.insights.length > 0 && (
              <Card className="gap-3 py-4">
                <CardHeader className="px-4">
                  <CardTitle className="text-sm font-medium">Insights</CardTitle>
                </CardHeader>
                <CardContent className="px-4">
                  <InsightsList insights={analytics.data.insights} />
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="team">
            <MembersPanel project={p} />
          </TabsContent>

          <TabsContent value="billing">
            <BillingConfigPanel project={p} />
          </TabsContent>

          <TabsContent value="timesheets">
            <Card className="gap-3 py-4">
              <CardContent className="px-4">
                {timesheets.data?.items.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">No timesheets for this project yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Period</TableHead>
                        <TableHead className="text-right">Tracked</TableHead>
                        <TableHead className="text-right">Billable</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {timesheets.data?.items.map((t) => (
                        <TableRow key={t.id} className="text-sm">
                          <TableCell>{t.user.displayName}</TableCell>
                          <TableCell className="text-xs">{formatPeriod(t.reportingPeriodStart, t.reportingPeriodEnd, tz)}</TableCell>
                          <TableCell className="tabular text-right">{formatHours(t.trackedSeconds, 2)}</TableCell>
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
                <Button asChild variant="link" size="sm" className="mt-2 px-0">
                  <Link href="/billing">Review in Billing →</Link>
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit">
            <Card className="gap-3 py-4">
              <CardContent className="px-4">
                {audit.error ? (
                  <ErrorState message={audit.error.message} />
                ) : audit.data?.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">No audit records visible to you for this project.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {audit.data?.map((a) => (
                      <div key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-xs">
                        <span className="w-32 text-muted-foreground">{formatDateTime(a.createdAt, tz)}</span>
                        <span className="font-mono text-[11px] text-primary">{a.action}</span>
                        <span>{a.actor?.displayName ?? "System"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
      {p && <ProjectFormDialog open={editing} onOpenChange={setEditing} initial={p} isAdmin={isAdmin} />}
    </div>
  );
}

function MembersPanel({ project }: { project: ProjectDetail }) {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("Contributor");
  const directory = useApi<Page<{ id: string; displayName: string; role: string }>>(["directory"], project.canManage ? "/api/employees?pageSize=200" : null);
  const add = useApiMutation<{ userId: string; assignedRole: string }>("POST", `/api/projects/${project.id}/members`, {
    success: "Employee assigned",
    invalidate: [["project", project.id], ["projects"]],
    onSuccess: () => setUserId(""),
  });
  const remove = useApiMutation<{ userId: string }>("DELETE", (b) => `/api/projects/${project.id}/members?userId=${b.userId}`, {
    success: "Employee unassigned",
    invalidate: [["project", project.id], ["projects"]],
  });
  const memberIds = new Set(project.members.map((m) => m.user.id));
  const candidates = (directory.data?.items ?? []).filter((u) => !memberIds.has(u.id));

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">Assigned employees</CardTitle>
        <CardDescription className="text-xs">Only assigned employees can log activity against this project.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-4">
        {project.canManage && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger className="w-[240px]" aria-label="Employee to assign">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assigned-role">Project role</Label>
              <Input id="assigned-role" value={role} onChange={(e) => setRole(e.target.value)} className="w-[180px]" />
            </div>
            <Button disabled={!userId || add.isPending} onClick={() => add.mutate({ userId, assignedRole: role })}>
              {add.isPending ? <Spinner /> : <Plus />} Assign
            </Button>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Organization role</TableHead>
              <TableHead>Project role</TableHead>
              <TableHead>Assigned</TableHead>
              {project.canManage && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {project.members.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <Link href={`/employees/${m.user.id}`} className="font-medium hover:text-primary">
                    {m.user.displayName}
                  </Link>
                  <p className="text-xs text-muted-foreground">{m.user.email}</p>
                </TableCell>
                <TableCell>
                  <RoleBadge role={m.user.role} />
                </TableCell>
                <TableCell className="text-sm">{m.assignedRole}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDate(m.assignedAt)}</TableCell>
                {project.canManage && (
                  <TableCell>
                    <ConfirmDialog
                      trigger={
                        <Button variant="ghost" size="icon-sm" aria-label={`Unassign ${m.user.displayName}`}>
                          <UserMinus />
                        </Button>
                      }
                      title={`Unassign ${m.user.displayName}?`}
                      description="Existing tracked time and timesheets are kept. New activity for this project will be rejected for them."
                      confirmLabel="Unassign"
                      destructive
                      onConfirm={() => remove.mutateAsync({ userId: m.user.id })}
                    />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function BillingConfigPanel({ project }: { project: ProjectDetail }) {
  const tools = useApi<{ id: string; name: string; category: string; defaultBillableStatus: boolean }[]>(["tools"], "/api/tools");
  const [cfg, setCfg] = useState(project.billingConfig);
  useEffect(() => setCfg(project.billingConfig), [project.billingConfig]);
  const save = useApiMutation<typeof cfg>("PUT", `/api/projects/${project.id}/billing-config`, { success: "Billing rules saved — new activity uses them", invalidate: [["project", project.id]] });
  const disabled = !project.canManage;
  const toolMode = (id: string) => (cfg.billableToolIds.includes(id) ? "always" : cfg.nonBillableToolIds.includes(id) ? "never" : "default");
  const setToolMode = (id: string, mode: string) =>
    setCfg((c) => ({
      ...c,
      billableToolIds: mode === "always" ? [...c.billableToolIds.filter((t) => t !== id), id] : c.billableToolIds.filter((t) => t !== id),
      nonBillableToolIds: mode === "never" ? [...c.nonBillableToolIds.filter((t) => t !== id), id] : c.nonBillableToolIds.filter((t) => t !== id),
    }));

  return (
    <Card className="gap-4 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-sm">Project billing configuration</CardTitle>
        <CardDescription className="text-xs">Applied by the worker when activity is classified. Deep focus is an activity category, not a billing rule — billability is decided here.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 px-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Billable activity categories</Label>
            {(["ACTIVE_WORK", "DEEP_FOCUS"] as const).map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <Checkbox
                  disabled={disabled}
                  checked={cfg.billableCategories.includes(c)}
                  onCheckedChange={(v) => setCfg((s) => ({ ...s, billableCategories: v ? [...new Set([...s.billableCategories, c])] : s.billableCategories.filter((x) => x !== c) }))}
                />
                {c === "ACTIVE_WORK" ? "Active work" : "Deep focus"}
              </label>
            ))}
          </div>
          <label className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
            Collaboration sessions are billable
            <Switch disabled={disabled} checked={cfg.collaborationBillable} onCheckedChange={(v) => setCfg((s) => ({ ...s, collaborationBillable: v }))} />
          </label>
          <label className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
            Administrative sessions are billable
            <Switch disabled={disabled} checked={cfg.administrativeBillable} onCheckedChange={(v) => setCfg((s) => ({ ...s, administrativeBillable: v }))} />
          </label>
          <label className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
            Timesheets require approval
            <Switch disabled={disabled} checked={cfg.requiresApproval} onCheckedChange={(v) => setCfg((s) => ({ ...s, requiresApproval: v }))} />
          </label>
          <div className="space-y-1.5">
            <Label>Rounding rule (applied per timesheet)</Label>
            <Select disabled={disabled} value={cfg.roundingRule} onValueChange={(v) => setCfg((s) => ({ ...s, roundingRule: v }))}>
              <SelectTrigger className="w-full" aria-label="Rounding rule">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">No rounding (exact seconds)</SelectItem>
                <SelectItem value="UP_6_MIN">Round up to 6 minutes (0.1 h)</SelectItem>
                <SelectItem value="UP_15_MIN">Round up to 15 minutes</SelectItem>
                <SelectItem value="NEAREST_15_MIN">Round to nearest 15 minutes</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label>Tool billability on this project</Label>
          <div className="divide-y divide-border rounded-md border border-border">
            {tools.data?.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  {t.name} <span className="text-xs text-muted-foreground">· default {t.defaultBillableStatus ? "billable" : "non-billable"}</span>
                </span>
                <Select disabled={disabled} value={toolMode(t.id)} onValueChange={(v) => setToolMode(t.id, v)}>
                  <SelectTrigger className="h-8 w-[140px]" aria-label={`${t.name} billability`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Tool default</SelectItem>
                    <SelectItem value="always">Always billable</SelectItem>
                    <SelectItem value="never">Never billable</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>
        {project.canManage && (
          <div className="lg:col-span-2">
            <Button disabled={save.isPending} onClick={() => save.mutate(cfg)}>
              {save.isPending && <Spinner />} Save billing rules
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

