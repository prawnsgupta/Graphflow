"use client";

import Link from "next/link";
import { useState } from "react";
import { FolderPlus, Search, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApi } from "@/hooks/use-api";
import { qs } from "@/lib/api/client";
import type { BudgetDTO, OverviewDTO, Page } from "@/types/api";
import { PageHeader } from "@/components/shared/page-header";
import { FilterSelect, Pagination } from "@/components/shared/filters";
import { EmptyState, ErrorState, LoadingRows } from "@/components/shared/states";
import { ProjectStatusBadge } from "@/components/shared/badges";
import { formatDate, formatMoney, formatPct } from "@/components/shared/format";
import { ProjectFormDialog } from "./project-form-dialog";

interface ProjectRow {
  id: string;
  name: string;
  clientName: string | null;
  budgetHours: string;
  hourlyRate: string;
  currency: string;
  status: string;
  deadline: string | null;
  team: { id: string; name: string } | null;
  projectManager: { id: string; displayName: string } | null;
  _count: { members: number };
}

export function ProjectsView({ canCreate, isAdmin }: { canCreate: boolean; isAdmin: boolean }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [teamId, setTeamId] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const list = useApi<Page<ProjectRow>>(["projects", search, status, teamId, page], `/api/projects${qs({ search, status, teamId, page, pageSize: 20 })}`);
  const teams = useApi<{ id: string; name: string }[]>(["teams"], "/api/teams");
  // Budget utilization comes from the analytics service (approved timesheets).
  const overview = useApi<OverviewDTO>(["overview-budgets"], "/api/analytics/overview");
  const budgets = new Map<string, BudgetDTO>((overview.data?.budgets ?? []).map((b) => [b.id, b]));

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Budgets, rates and assignments. Utilization uses approved billable hours only."
        actions={
          canCreate && (
            <Button onClick={() => setCreating(true)}>
              <FolderPlus /> New project
            </Button>
          )
        }
      />
      <Card className="gap-0 py-4">
        <CardContent className="px-4">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input placeholder="Search project or client" className="h-9 w-[240px] pl-8" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search projects" />
            </div>
            <FilterSelect label="Status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} allLabel="All statuses" options={["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"].map((s) => ({ value: s, label: s.replace("_", " ") }))} />
            <FilterSelect label="Team" value={teamId} onChange={(v) => { setTeamId(v); setPage(1); }} allLabel="All teams" options={(teams.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />
          </div>
          {list.error ? (
            <ErrorState message={list.error.message} onRetry={() => list.refetch()} />
          ) : list.isLoading ? (
            <LoadingRows rows={6} />
          ) : list.data!.items.length === 0 ? (
            <EmptyState title="No projects found" description={canCreate ? "Create your first project to start tracking billable work." : "You are not assigned to any projects yet."} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Team / PM</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="w-[200px]">Budget utilization</TableHead>
                      <TableHead className="text-right">Members</TableHead>
                      <TableHead>Deadline</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.data!.items.map((p) => {
                      const b = budgets.get(p.id);
                      return (
                        <TableRow key={p.id}>
                          <TableCell>
                            <Link href={`/projects/${p.id}`} className="font-medium hover:text-primary">
                              {p.name}
                            </Link>
                            <p className="text-xs text-muted-foreground">{p.clientName ?? "Internal"}</p>
                          </TableCell>
                          <TableCell>
                            <ProjectStatusBadge status={p.status} />
                          </TableCell>
                          <TableCell className="text-xs">
                            <p>{p.team?.name ?? "—"}</p>
                            <p className="text-muted-foreground">{p.projectManager?.displayName ?? "No PM"}</p>
                          </TableCell>
                          <TableCell className="tabular text-right text-sm">{formatMoney(p.hourlyRate, p.currency)}/h</TableCell>
                          <TableCell>
                            {Number(p.budgetHours) > 0 ? (
                              <div className="text-xs">
                                <div className="mb-1 flex justify-between">
                                  <span className="tabular text-muted-foreground">{b ? `${Math.round(b.approvedBillableSeconds / 360) / 10}` : "—"} / {Number(p.budgetHours)} h</span>
                                  <span className={(b?.utilizationPct ?? 0) >= 100 ? "text-destructive" : (b?.utilizationPct ?? 0) >= 80 ? "text-warning" : ""}>{formatPct(b?.utilizationPct ?? null)}</span>
                                </div>
                                <Progress value={Math.min(100, b?.utilizationPct ?? 0)} className="h-1.5" />
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">No budget</span>
                            )}
                          </TableCell>
                          <TableCell className="tabular text-right">
                            <span className="inline-flex items-center gap-1 text-sm">
                              <Users className="size-3.5 text-muted-foreground" /> {p._count.members}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{formatDate(p.deadline, "UTC")}</TableCell>
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
      {canCreate && <ProjectFormDialog open={creating} onOpenChange={setCreating} isAdmin={isAdmin} />}
    </div>
  );
}
