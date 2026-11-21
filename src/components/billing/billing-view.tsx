"use client";

import { useState } from "react";
import { CheckCircle2, Download, FilePlus2, History, MoreHorizontal, Send, Undo2, XCircle, Calculator, PencilLine, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApi, useApiMutation } from "@/hooks/use-api";
import { qs } from "@/lib/api/client";
import type { Page } from "@/types/api";
import { PageHeader } from "@/components/shared/page-header";
import { FilterSelect, Pagination } from "@/components/shared/filters";
import { EmptyState, ErrorState, LoadingRows, Spinner } from "@/components/shared/states";
import { KpiCard } from "@/components/shared/kpi-card";
import { TimesheetStatusBadge } from "@/components/shared/badges";
import { formatDate, formatDateTime, formatHours, formatMoney, formatPct, formatPeriod, hoursInput } from "@/components/shared/format";

interface Timesheet {
  id: string;
  userId: string;
  projectId: string;
  reportingPeriodStart: string;
  reportingPeriodEnd: string;
  trackedSeconds: number;
  billableSeconds: number;
  nonBillableSeconds: number;
  calculatedBillableSeconds: number;
  hourlyRate: string;
  currency: string;
  billableAmount: string;
  status: string;
  notes: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  user: { id: string; displayName: string };
  project: { id: string; name: string; projectManagerId: string | null };
  reviewedBy: { displayName: string } | null;
}
interface Summary {
  approvedBillableSeconds: number;
  approvedAmount: string;
  statuses: { status: string; count: number; billableSeconds: number; amount: string }[];
  projects: { projectId: string; name: string; hourlyRate: string; approvedSeconds: number; approvedAmount: string; pendingSeconds: number; currency: string }[];
}

const EDITABLE = ["DRAFT", "REJECTED", "ADJUSTMENT_REQUIRED"];

function mondayKey(offsetWeeks = 0) {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + offsetWeeks * 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function BillingView({ userId, isReviewer, isAdmin, canAudit }: { userId: string; isReviewer: boolean; isAdmin: boolean; canAudit: boolean }) {
  const [tab, setTab] = useState(isReviewer ? "review" : "mine");
  const [status, setStatus] = useState("");
  const [projectId, setProjectId] = useState("");
  const [page, setPage] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [action, setAction] = useState<{ kind: "reject" | "request-adjustment" | "adjust" | "details"; ts: Timesheet } | null>(null);

  const scope = tab === "review" ? "review" : tab === "mine" ? "mine" : "all";
  const q = { scope, status: tab === "review" ? "" : status, projectId, page, pageSize: 20 };
  const list = useApi<Page<Timesheet>>(["timesheets", q], `/api/timesheets${qs(q)}`);
  const summary = useApi<Summary>(["billing-summary", projectId], `/api/billing/summary${qs({ projectId })}`);
  const projects = useApi<Page<{ id: string; name: string }>>(["projects-all"], "/api/projects?pageSize=200");
  const invalidate = [["timesheets"], ["billing-summary"], ["overview"]];
  const submit = useApiMutation<{ id: string }>("POST", (b) => `/api/timesheets/${b.id}/submit`, { success: "Timesheet submitted for approval", invalidate });
  const approve = useApiMutation<{ id: string }>("POST", (b) => `/api/timesheets/${b.id}/approve`, { success: "Timesheet approved — billing totals updated", invalidate });
  const remove = useApiMutation<{ id: string }>("DELETE", (b) => `/api/timesheets/${b.id}`, { success: "Draft deleted", invalidate });

  const st = (s: string) => summary.data?.statuses.find((x) => x.status === s);

  return (
    <div>
      <PageHeader
        title="Billing & timesheets"
        description="Timesheets are generated from tracked activity as drafts. Only approved timesheets count towards billing totals."
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={`/api/billing/export${qs({ projectId })}`} download>
                <Download /> Export CSV
              </a>
            </Button>
            <Button onClick={() => setGenerating(true)}>
              <FilePlus2 /> Generate timesheets
            </Button>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard loading={summary.isLoading} label="Approved billable" tone="success" icon={CheckCircle2} value={summary.data ? formatHours(summary.data.approvedBillableSeconds) : "—"} hint={summary.data && formatMoney(summary.data.approvedAmount)} />
        <KpiCard loading={summary.isLoading} label="Awaiting approval" tone="primary" icon={Send} value={st("SUBMITTED")?.count ?? 0} hint={st("SUBMITTED") && `${formatHours(st("SUBMITTED")!.billableSeconds)} · ${formatMoney(st("SUBMITTED")!.amount)}`} />
        <KpiCard loading={summary.isLoading} label="Drafts" icon={PencilLine} value={st("DRAFT")?.count ?? 0} hint={st("DRAFT") && formatHours(st("DRAFT")!.billableSeconds)} />
        <KpiCard loading={summary.isLoading} label="Rejected / needs adjustment" tone="danger" icon={XCircle} value={(st("REJECTED")?.count ?? 0) + (st("ADJUSTMENT_REQUIRED")?.count ?? 0)} />
      </div>

      <Tabs value={tab} onValueChange={(v) => { setTab(v); setPage(1); }}>
        <TabsList className="mb-4">
          {isReviewer && <TabsTrigger value="review">Review queue</TabsTrigger>}
          <TabsTrigger value="mine">My timesheets</TabsTrigger>
          {(isReviewer || isAdmin) && <TabsTrigger value="all">All visible</TabsTrigger>}
          <TabsTrigger value="projects">Project totals</TabsTrigger>
          {canAudit && <TabsTrigger value="audits">Billable audits</TabsTrigger>}
        </TabsList>

        {["review", "mine", "all"].map((t) => (
          <TabsContent key={t} value={t}>
            <Card className="gap-0 py-4">
              <CardContent className="px-4">
                <div className="mb-4 flex flex-wrap gap-2">
                  {t !== "review" && <FilterSelect label="Status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} allLabel="All statuses" options={["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "ADJUSTMENT_REQUIRED"].map((s) => ({ value: s, label: s.replace("_", " ").toLowerCase() }))} />}
                  <FilterSelect label="Project" value={projectId} onChange={(v) => { setProjectId(v); setPage(1); }} allLabel="All projects" options={(projects.data?.items ?? []).map((p) => ({ value: p.id, label: p.name }))} />
                </div>
                {list.error ? (
                  <ErrorState message={list.error.message} onRetry={() => list.refetch()} />
                ) : list.isLoading ? (
                  <LoadingRows rows={6} />
                ) : list.data!.items.length === 0 ? (
                  <EmptyState title={t === "review" ? "Nothing awaiting your review" : "No timesheets"} description={t === "mine" ? "Generate a timesheet from your tracked activity to get started." : undefined} />
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Employee</TableHead>
                            <TableHead>Project</TableHead>
                            <TableHead>Period</TableHead>
                            <TableHead className="text-right">Tracked</TableHead>
                            <TableHead className="text-right">Billable</TableHead>
                            <TableHead className="text-right">Rate</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="w-[180px] text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {list.data!.items.map((ts) => {
                            const own = ts.userId === userId;
                            const canReview = !own && ts.status === "SUBMITTED" && (isAdmin || ts.project.projectManagerId === userId);
                            return (
                              <TableRow key={ts.id} className="text-sm" data-testid={`timesheet-${ts.id}`}>
                                <TableCell>{ts.user.displayName}</TableCell>
                                <TableCell className="max-w-[180px] truncate">{ts.project.name}</TableCell>
                                <TableCell className="whitespace-nowrap text-xs">{formatPeriod(ts.reportingPeriodStart, ts.reportingPeriodEnd)}</TableCell>
                                <TableCell className="tabular text-right">{formatHours(ts.trackedSeconds, 2)}</TableCell>
                                <TableCell className="tabular text-right">
                                  {formatHours(ts.billableSeconds, 2)}
                                  {ts.billableSeconds !== ts.calculatedBillableSeconds && <span className="ml-1 text-[10px] text-warning" title="Adjusted">adj</span>}
                                </TableCell>
                                <TableCell className="tabular text-right text-xs text-muted-foreground">{formatMoney(ts.hourlyRate, ts.currency)}</TableCell>
                                <TableCell className="tabular text-right font-medium">{formatMoney(ts.billableAmount, ts.currency)}</TableCell>
                                <TableCell>
                                  <TimesheetStatusBadge status={ts.status} />
                                  {ts.rejectionReason && ["REJECTED", "ADJUSTMENT_REQUIRED"].includes(ts.status) && <p className="mt-1 max-w-[200px] truncate text-[11px] text-muted-foreground" title={ts.rejectionReason}>{ts.rejectionReason}</p>}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    {own && EDITABLE.includes(ts.status) && (
                                      <Button size="sm" disabled={submit.isPending} onClick={() => submit.mutate({ id: ts.id })}>
                                        <Send /> Submit
                                      </Button>
                                    )}
                                    {canReview && (
                                      <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate({ id: ts.id })}>
                                        <CheckCircle2 /> Approve
                                      </Button>
                                    )}
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon-sm" aria-label="More actions">
                                          <MoreHorizontal />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => setAction({ kind: "details", ts })}>
                                          <History /> Details & history
                                        </DropdownMenuItem>
                                        {own && EDITABLE.includes(ts.status) && (
                                          <DropdownMenuItem onClick={() => setAction({ kind: "adjust", ts })}>
                                            <PencilLine /> Correct billable time
                                          </DropdownMenuItem>
                                        )}
                                        {canReview && (
                                          <>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onClick={() => setAction({ kind: "adjust", ts })}>
                                              <PencilLine /> Adjust billable time
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => setAction({ kind: "request-adjustment", ts })}>
                                              <Undo2 /> Request adjustment
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => setAction({ kind: "reject", ts })} className="text-destructive">
                                              <XCircle /> Reject
                                            </DropdownMenuItem>
                                          </>
                                        )}
                                        {own && ts.status === "DRAFT" && (
                                          <DropdownMenuItem onClick={() => remove.mutate({ id: ts.id })} className="text-destructive">
                                            <Trash2 /> Delete draft
                                          </DropdownMenuItem>
                                        )}
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                    <Pagination page={page} pageSize={20} total={list.data!.total} onPage={setPage} />
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}

        <TabsContent value="projects">
          <Card className="gap-0 py-4">
            <CardContent className="px-4">
              {summary.data?.projects.length === 0 ? (
                <EmptyState title="No billing data yet" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead className="text-right">Hourly rate</TableHead>
                      <TableHead className="text-right">Approved billable</TableHead>
                      <TableHead className="text-right">Approved amount</TableHead>
                      <TableHead className="text-right">Pending approval</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.data?.projects.map((p) => (
                      <TableRow key={p.projectId} className="text-sm">
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="tabular text-right">{formatMoney(p.hourlyRate, p.currency)}</TableCell>
                        <TableCell className="tabular text-right">{formatHours(p.approvedSeconds, 2)}</TableCell>
                        <TableCell className="tabular text-right font-medium">{formatMoney(p.approvedAmount, p.currency)}</TableCell>
                        <TableCell className="tabular text-right text-muted-foreground">{formatHours(p.pendingSeconds, 2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {canAudit && (
          <TabsContent value="audits">
            <AuditsPanel projects={projects.data?.items ?? []} />
          </TabsContent>
        )}
      </Tabs>

      <GenerateDialog open={generating} onOpenChange={setGenerating} isReviewer={isReviewer} projects={projects.data?.items ?? []} userId={userId} />
      {action && action.kind === "details" && <DetailsDialog ts={action.ts} onClose={() => setAction(null)} />}
      {action && (action.kind === "reject" || action.kind === "request-adjustment") && <ReasonDialog kind={action.kind} ts={action.ts} onClose={() => setAction(null)} />}
      {action && action.kind === "adjust" && <AdjustDialog ts={action.ts} onClose={() => setAction(null)} />}
    </div>
  );
}

function GenerateDialog({ open, onOpenChange, isReviewer, projects, userId }: { open: boolean; onOpenChange: (o: boolean) => void; isReviewer: boolean; projects: { id: string; name: string }[]; userId: string }) {
  const [periodStart, setPeriodStart] = useState(mondayKey(0));
  const [projectId, setProjectId] = useState("");
  const [forTeam, setForTeam] = useState(false);
  const gen = useApiMutation<Record<string, unknown>, { created: number; updated: number; skipped: number; empty: number }>("POST", "/api/timesheets/generate", {
    success: (r) => `Generated: ${r.created} new, ${r.updated} refreshed, ${r.skipped} locked (submitted/approved), ${r.empty} without activity`,
    invalidate: [["timesheets"], ["billing-summary"]],
    onSuccess: () => onOpenChange(false),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate timesheets</DialogTitle>
          <DialogDescription>Creates or refreshes DRAFT timesheets from tracked activity for a 7-day period (organization timezone). Submitted and approved timesheets are never overwritten.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant={periodStart === mondayKey(0) ? "default" : "outline"} size="sm" onClick={() => setPeriodStart(mondayKey(0))}>
              This week
            </Button>
            <Button type="button" variant={periodStart === mondayKey(-1) ? "default" : "outline"} size="sm" onClick={() => setPeriodStart(mondayKey(-1))}>
              Last week
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gen-start">Period start</Label>
            <Input id="gen-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Project</Label>
            <Select value={projectId || "all"} onValueChange={(v) => setProjectId(v === "all" ? "" : v)}>
              <SelectTrigger className="w-full" aria-label="Project">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All my projects</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isReviewer && projectId && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={forTeam} onChange={(e) => setForTeam(e.target.checked)} className="accent-[#647CFF]" />
              Generate for every member of this project (projects you manage)
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={gen.isPending} onClick={() => gen.mutate({ periodStart, ...(projectId ? { projectId } : {}), ...(isReviewer && projectId && !forTeam ? { userId } : {}) })} data-testid="generate-confirm">
            {gen.isPending && <Spinner />} Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReasonDialog({ kind, ts, onClose }: { kind: "reject" | "request-adjustment"; ts: Timesheet; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const m = useApiMutation<{ reason: string }>("POST", `/api/timesheets/${ts.id}/${kind}`, {
    success: kind === "reject" ? "Timesheet rejected" : "Adjustment requested",
    invalidate: [["timesheets"], ["billing-summary"]],
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{kind === "reject" ? "Reject timesheet" : "Request adjustment"}</DialogTitle>
          <DialogDescription>
            {ts.user.displayName} · {ts.project.name} · {formatPeriod(ts.reportingPeriodStart, ts.reportingPeriodEnd)}. The reason is shown to the employee and recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain what needs to change" aria-label="Reason" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={kind === "reject" ? "destructive" : "default"} disabled={reason.trim().length < 3 || m.isPending} onClick={() => m.mutate({ reason })}>
            {m.isPending && <Spinner />} {kind === "reject" ? "Reject" : "Send back"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({ ts, onClose }: { ts: Timesheet; onClose: () => void }) {
  const [hours, setHours] = useState(String(hoursInput(ts.billableSeconds)));
  const [reason, setReason] = useState("");
  const seconds = Math.round(Number(hours) * 3600);
  const valid = Number.isFinite(seconds) && seconds >= 0 && seconds <= ts.trackedSeconds && seconds !== ts.billableSeconds && reason.trim().length >= 3;
  const m = useApiMutation<{ billableSeconds: number; reason: string }>("POST", `/api/timesheets/${ts.id}/adjust`, {
    success: "Billable time adjusted (history preserved)",
    invalidate: [["timesheets"], ["billing-summary"]],
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust billable time</DialogTitle>
          <DialogDescription>Tracked {formatHours(ts.trackedSeconds, 2)} · currently billable {formatHours(ts.billableSeconds, 2)} · calculated from activity {formatHours(ts.calculatedBillableSeconds, 2)}. Every adjustment is preserved.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="adj-hours">Billable hours</Label>
            <Input id="adj-hours" type="number" step="0.01" min={0} max={hoursInput(ts.trackedSeconds)} value={hours} onChange={(e) => setHours(e.target.value)} />
            <p className="text-xs text-muted-foreground">New amount: {formatMoney(((seconds / 3600) * Number(ts.hourlyRate)).toFixed(2), ts.currency)} (cannot exceed tracked time)</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adj-reason">Reason</Label>
            <Textarea id="adj-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || m.isPending} onClick={() => m.mutate({ billableSeconds: seconds, reason })}>
            {m.isPending && <Spinner />} Save adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailsDialog({ ts, onClose }: { ts: Timesheet; onClose: () => void }) {
  const d = useApi<Timesheet & { adjustments: { id: string; previousBillableSeconds: number; adjustedBillableSeconds: number; reason: string; createdAt: string; adjustedBy: { displayName: string } }[] }>(["timesheet", ts.id], `/api/timesheets/${ts.id}`);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {ts.project.name} · {formatPeriod(ts.reportingPeriodStart, ts.reportingPeriodEnd)}
          </DialogTitle>
          <DialogDescription>{ts.user.displayName}</DialogDescription>
        </DialogHeader>
        {!d.data ? (
          <LoadingRows rows={3} />
        ) : (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Field label="Status" value={<TimesheetStatusBadge status={d.data.status} />} />
              <Field label="Amount" value={formatMoney(d.data.billableAmount, d.data.currency)} />
              <Field label="Tracked" value={formatHours(d.data.trackedSeconds, 2)} />
              <Field label="Billable" value={`${formatHours(d.data.billableSeconds, 2)} (${formatPct((d.data.billableSeconds / Math.max(1, d.data.trackedSeconds)) * 100)})`} />
              <Field label="Submitted" value={formatDateTime(d.data.submittedAt)} />
              <Field label="Reviewed" value={d.data.reviewedAt ? `${formatDateTime(d.data.reviewedAt)}${d.data.reviewedBy ? ` by ${d.data.reviewedBy.displayName}` : " (auto)"}` : "—"} />
            </div>
            {d.data.rejectionReason && <p className="rounded-md border border-warning/30 bg-warning/10 p-2 text-xs">{d.data.rejectionReason}</p>}
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Billing adjustment history</p>
              {d.data.adjustments.length === 0 ? (
                <p className="text-xs text-muted-foreground">No adjustments — billable time is exactly as calculated from activity.</p>
              ) : (
                <ul className="space-y-2">
                  {d.data.adjustments.map((a) => (
                    <li key={a.id} className="rounded-md border border-border p-2 text-xs">
                      <span className="tabular font-medium">
                        {formatHours(a.previousBillableSeconds, 2)} → {formatHours(a.adjustedBillableSeconds, 2)}
                      </span>{" "}
                      by {a.adjustedBy.displayName} · {formatDate(a.createdAt)}
                      <p className="text-muted-foreground">{a.reason}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md bg-surface-2/40 p-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}

function AuditsPanel({ projects }: { projects: { id: string; name: string }[] }) {
  const [from, setFrom] = useState(mondayKey(-2));
  const [to, setTo] = useState(mondayKey(0));
  const [projectId, setProjectId] = useState("");
  const list = useApi<Page<{ id: string; reportingPeriodStart: string; reportingPeriodEnd: string; totalTrackedSeconds: number; totalBillableSeconds: number; approvedBillableSeconds: number; totalFrictionSeconds: number; contextSwitchCount: number; billableAmount: string; budgetUtilizationPercentage: string; calculatedAt: string; project: { name: string; currency: string } }>>(
    ["audits", projectId],
    `/api/billing/audits${qs({ projectId, pageSize: 30 })}`,
  );
  const run = useApiMutation<Record<string, unknown>, { created: number }>("POST", "/api/billing/audits", { success: (r) => `${r.created} billable audit snapshot(s) calculated`, invalidate: [["audits"]] });
  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Calculator className="size-4 text-primary" /> Billable audits
        </CardTitle>
        <CardDescription className="text-xs">Immutable snapshots of tracked, billable, approved and friction time per project for a reporting period. The worker also records one per active project daily.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="aud-from">From</Label>
            <Input id="aud-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[150px]" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="aud-to">To</Label>
            <Input id="aud-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-[150px]" />
          </div>
          <FilterSelect label="Project" value={projectId} onChange={setProjectId} allLabel="All my projects" options={projects.map((p) => ({ value: p.id, label: p.name }))} />
          <Button disabled={run.isPending || from > to} onClick={() => run.mutate({ from, to, ...(projectId ? { projectId } : {}) })}>
            {run.isPending && <Spinner />} Run audit
          </Button>
        </div>
        {list.data?.items.length === 0 ? (
          <EmptyState title="No audits yet" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Tracked</TableHead>
                  <TableHead className="text-right">Classified billable</TableHead>
                  <TableHead className="text-right">Approved</TableHead>
                  <TableHead className="text-right">Friction</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Budget used</TableHead>
                  <TableHead>Calculated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data?.items.map((a) => (
                  <TableRow key={a.id} className="text-xs">
                    <TableCell className="font-medium">{a.project.name}</TableCell>
                    <TableCell>{formatPeriod(a.reportingPeriodStart, a.reportingPeriodEnd)}</TableCell>
                    <TableCell className="tabular text-right">{formatHours(a.totalTrackedSeconds)}</TableCell>
                    <TableCell className="tabular text-right">{formatHours(a.totalBillableSeconds)}</TableCell>
                    <TableCell className="tabular text-right">{formatHours(a.approvedBillableSeconds)}</TableCell>
                    <TableCell className="tabular text-right">{formatHours(a.totalFrictionSeconds)}</TableCell>
                    <TableCell className="tabular text-right">{formatMoney(a.billableAmount, a.project.currency)}</TableCell>
                    <TableCell className="tabular text-right">{Number(a.budgetUtilizationPercentage).toFixed(1)}%</TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(a.calculatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
