"use client";

import { useState } from "react";
import { Network, Pencil, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApi, useApiMutation } from "@/hooks/use-api";
import { qs } from "@/lib/api/client";
import type { Page } from "@/types/api";
import { PageHeader } from "@/components/shared/page-header";
import { DateRangeFilter, presetRange, type DateRange } from "@/components/shared/filters";
import { EmptyState, ErrorState, LoadingRows, Spinner } from "@/components/shared/states";
import { RoleBadge } from "@/components/shared/badges";
import { formatHours, formatPct } from "@/components/shared/format";
import { HorizontalBars } from "@/components/charts/charts";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

interface TeamAnalytics {
  range: { timezone: string };
  teams: {
    id: string;
    name: string;
    description: string | null;
    manager: { id: string; displayName: string } | null;
    memberCount: number;
    trackedSeconds: number;
    activeSeconds: number;
    deepFocusSeconds: number;
    billableSeconds: number;
    billableUtilization: number;
    focusRatio: number;
    contextSwitches: number;
    switchesPerHour: number;
    workloadHoursPerMember: number;
    allocation: { projectId: string | null; name: string; seconds: number }[];
    members: { id: string; displayName: string; role: string; activeSeconds: number; deepFocusSeconds: number; billableSeconds: number; contextSwitches: number }[];
    collaboration: { a: string; b: string; seconds: number; count: number }[];
  }[];
}

export function TeamsView({ canManage }: { canManage: boolean }) {
  const [range, setRange] = useState<DateRange>(presetRange(14));
  const [editing, setEditing] = useState<{ id?: string; name: string; description: string; managerId: string } | null>(null);
  const data = useApi<TeamAnalytics>(["team-analytics", range], `/api/teams/analytics${qs(range)}`);
  const del = useApiMutation<{ id: string }>("DELETE", (b) => `/api/teams/${b.id}`, { success: "Team deleted", invalidate: [["team-analytics"], ["teams"]] });

  return (
    <div>
      <PageHeader
        title="Team analytics"
        description="Aggregate workload, focus and collaboration. Team metrics describe workflows, not individual performance."
        actions={
          <>
            <DateRangeFilter value={range} onChange={setRange} />
            {canManage && (
              <Button onClick={() => setEditing({ name: "", description: "", managerId: "" })}>
                <Plus /> New team
              </Button>
            )}
          </>
        }
      />
      {data.error ? (
        <ErrorState message={data.error.message} onRetry={() => data.refetch()} />
      ) : data.isLoading ? (
        <LoadingRows rows={6} />
      ) : data.data!.teams.length === 0 ? (
        <EmptyState title="No teams to show" description={canManage ? "Create a team to group employees." : "You are not leading a team."} />
      ) : (
        <div className="space-y-4">
          {data.data!.teams.map((t) => (
            <Card key={t.id} className="gap-4 py-5">
              <CardHeader className="flex flex-row items-start justify-between gap-2 px-5">
                <div>
                  <CardTitle className="text-base">{t.name}</CardTitle>
                  <CardDescription className="text-xs">
                    {t.description ?? "—"} · Lead {t.manager?.displayName ?? "unassigned"} · {t.memberCount} members
                  </CardDescription>
                </div>
                {canManage && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon-sm" aria-label={`Edit ${t.name}`} onClick={() => setEditing({ id: t.id, name: t.name, description: t.description ?? "", managerId: t.manager?.id ?? "" })}>
                      <Pencil />
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${t.name}`}>
                          <Trash2 />
                        </Button>
                      }
                      title={`Delete ${t.name}?`}
                      description="Teams with members cannot be deleted — reassign members first."
                      destructive
                      confirmLabel="Delete team"
                      onConfirm={() => del.mutateAsync({ id: t.id })}
                    />
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-5 px-5">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <Stat label="Workload / member" value={`${t.workloadHoursPerMember} h`} />
                  <Stat label="Active time" value={formatHours(t.activeSeconds)} />
                  <Stat label="Deep focus" value={formatHours(t.deepFocusSeconds)} sub={formatPct(t.focusRatio)} />
                  <Stat label="Billable utilization" value={formatPct(t.billableUtilization)} sub={formatHours(t.billableSeconds)} />
                  <Stat label="Context switches" value={String(t.contextSwitches)} sub={`${t.switchesPerHour}/active h`} />
                  <Stat label="Collaboration pairs" value={String(t.collaboration.length)} />
                </div>
                <div className="grid gap-5 lg:grid-cols-3">
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Project allocation</p>
                    {t.allocation.length === 0 ? <p className="text-xs text-muted-foreground">No activity.</p> : <HorizontalBars items={t.allocation.slice(0, 6).map((a) => ({ name: a.name, value: a.seconds / 3600 }))} />}
                  </div>
                  <div className="lg:col-span-2">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Members</p>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead className="text-right">Active</TableHead>
                            <TableHead className="text-right">Deep focus</TableHead>
                            <TableHead className="text-right">Billable</TableHead>
                            <TableHead className="text-right">Switches</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {t.members.map((m) => (
                            <TableRow key={m.id} className="text-sm">
                              <TableCell>
                                <span className="mr-2">{m.displayName}</span>
                                <RoleBadge role={m.role} />
                              </TableCell>
                              <TableCell className="tabular text-right">{formatHours(m.activeSeconds)}</TableCell>
                              <TableCell className="tabular text-right">{formatHours(m.deepFocusSeconds)}</TableCell>
                              <TableCell className="tabular text-right">{formatHours(m.billableSeconds)}</TableCell>
                              <TableCell className="tabular text-right">{m.contextSwitches}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Network className="size-3.5" /> Collaboration patterns (from overlapping project-session metadata only)
                  </p>
                  {t.collaboration.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No overlapping collaboration sessions in this period.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {t.collaboration.map((c) => (
                        <span key={`${c.a}-${c.b}`} className="rounded-md border border-border bg-surface-2/40 px-2.5 py-1.5 text-xs">
                          {c.a} ↔ {c.b} <span className="text-muted-foreground">· {formatHours(c.seconds)} · {c.count} sessions</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {canManage && editing && <TeamDialog initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="tabular mt-1 text-lg font-semibold">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function TeamDialog({ initial, onClose }: { initial: { id?: string; name: string; description: string; managerId: string }; onClose: () => void }) {
  const [v, setV] = useState(initial);
  const users = useApi<Page<{ id: string; displayName: string; role: string }>>(["directory"], "/api/employees?pageSize=200");
  const save = useApiMutation<Record<string, unknown>>(initial.id ? "PATCH" : "POST", initial.id ? `/api/teams/${initial.id}` : "/api/teams", {
    success: initial.id ? "Team updated" : "Team created",
    invalidate: [["team-analytics"], ["teams"]],
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial.id ? "Edit team" : "Create team"}</DialogTitle>
          <DialogDescription>Teams scope what team leads can see.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="team-name">Team name</Label>
            <Input id="team-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="team-desc">Description</Label>
            <Textarea id="team-desc" rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Team lead / manager</Label>
            <Select value={v.managerId || "none"} onValueChange={(m) => setV({ ...v, managerId: m === "none" ? "" : m })}>
              <SelectTrigger className="w-full" aria-label="Team manager">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {users.data?.items.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || v.name.trim().length < 2} onClick={() => save.mutate({ name: v.name, description: v.description || null, managerId: v.managerId || null })}>
            {save.isPending && <Spinner />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
