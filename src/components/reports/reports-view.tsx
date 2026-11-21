"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, FileText, Eye } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApi } from "@/hooks/use-api";
import { qs } from "@/lib/api/client";
import type { Page } from "@/types/api";
import { PageHeader } from "@/components/shared/page-header";
import { DateRangeFilter, FilterSelect, presetRange, type DateRange } from "@/components/shared/filters";
import { EmptyState, ErrorState, LoadingRows } from "@/components/shared/states";
import { cn } from "@/lib/utils";

interface ReportType {
  id: string;
  name: string;
  description: string;
}
interface Report {
  title: string;
  subtitle: string;
  timezone: string;
  period: { from: string; to: string };
  columns: string[];
  rows: (string | number)[][];
  summary: [string, string][];
  notes: string[];
}

export function ReportsView({ showFilters }: { showFilters: boolean }) {
  const types = useApi<ReportType[]>(["report-types"], "/api/reports");
  const [type, setType] = useState("project-billing");
  const [range, setRange] = useState<DateRange>(presetRange(30));
  const [projectId, setProjectId] = useState("");
  const [userId, setUserId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [preview, setPreview] = useState(false);
  const params = { ...range, projectId, userId, teamId };
  const report = useApi<Report>(["report", type, params], preview ? `/api/reports/${type}${qs(params)}` : null);
  const projects = useApi<Page<{ id: string; name: string }>>(["projects-all"], "/api/projects?pageSize=200");
  const users = useApi<Page<{ id: string; displayName: string }>>(["directory"], showFilters ? "/api/employees?pageSize=200" : null);
  const teams = useApi<{ id: string; name: string }[]>(["teams"], showFilters ? "/api/teams" : null);

  return (
    <div>
      <PageHeader title="Reports" description="Reports apply the same authorization and filters as the corresponding pages, and state their reporting period and timezone." />
      {types.error ? (
        <ErrorState message={types.error.message} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
          <div className="space-y-2">
            {types.isLoading && <LoadingRows rows={6} />}
            {types.data?.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setType(t.id);
                  setPreview(false);
                }}
                className={cn("w-full rounded-lg border p-3 text-left transition-colors", type === t.id ? "border-primary/50 bg-primary/10" : "border-border bg-card hover:border-primary/30")}
              >
                <p className="text-sm font-medium">{t.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
              </button>
            ))}
          </div>
          <Card className="gap-4 py-5">
            <CardHeader className="px-5">
              <CardTitle className="text-sm">{types.data?.find((t) => t.id === type)?.name ?? "Report"}</CardTitle>
              <CardDescription className="text-xs">Choose the period and scope, preview, then export.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 px-5">
              <div className="flex flex-wrap items-center gap-2">
                <DateRangeFilter value={range} onChange={(r) => { setRange(r); setPreview(false); }} />
                <FilterSelect label="Project" value={projectId} onChange={(v) => { setProjectId(v); setPreview(false); }} allLabel="All projects" options={(projects.data?.items ?? []).map((p) => ({ value: p.id, label: p.name }))} />
                {showFilters && <FilterSelect label="Employee" value={userId} onChange={(v) => { setUserId(v); setPreview(false); }} allLabel="All employees" options={(users.data?.items ?? []).map((u) => ({ value: u.id, label: u.displayName }))} />}
                {showFilters && <FilterSelect label="Team" value={teamId} onChange={(v) => { setTeamId(v); setPreview(false); }} allLabel="All teams" options={(teams.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => (preview ? report.refetch() : setPreview(true))}>
                  <Eye /> Preview
                </Button>
                <Button asChild>
                  <a href={`/api/reports/${type}${qs({ ...params, format: "csv" })}`} download>
                    <FileSpreadsheet /> Export CSV
                  </a>
                </Button>
                <Button asChild variant="secondary">
                  <a href={`/api/reports/${type}${qs({ ...params, format: "pdf" })}`} download>
                    <FileText /> Export PDF
                  </a>
                </Button>
              </div>
              {!preview ? (
                <EmptyState icon={Download} title="Preview or export this report" description="Exports are generated on the server from live database records and are recorded in the audit log." />
              ) : report.error ? (
                <ErrorState message={report.error.message} />
              ) : report.isLoading ? (
                <LoadingRows rows={6} />
              ) : (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium">{report.data!.title}</p>
                    <p className="text-xs text-muted-foreground">{report.data!.subtitle}</p>
                  </div>
                  {report.data!.rows.length === 0 ? (
                    <EmptyState title="No records for this period and scope" />
                  ) : (
                    <div className="scrollbar-thin max-h-[480px] overflow-auto rounded-md border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {report.data!.columns.map((c) => (
                              <TableHead key={c} className="whitespace-nowrap text-xs">
                                {c}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {report.data!.rows.map((r, i) => (
                            <TableRow key={i} className="text-xs">
                              {r.map((c, j) => (
                                <TableCell key={j} className={cn("whitespace-nowrap", typeof c === "number" && "tabular text-right")}>
                                  {c}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {report.data!.summary.map(([k, v]) => (
                      <span key={k} className="rounded-md bg-secondary px-2.5 py-1 text-xs">
                        <span className="text-muted-foreground">{k}: </span>
                        <span className="font-medium">{v}</span>
                      </span>
                    ))}
                  </div>
                  <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                    {report.data!.notes.map((n) => (
                      <li key={n}>· {n}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
