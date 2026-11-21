"use client";

import { useState } from "react";
import { RotateCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useApi, useApiMutation } from "@/hooks/use-api";
import { qs } from "@/lib/api/client";
import type { Page } from "@/types/api";
import { PageHeader } from "@/components/shared/page-header";
import { DateRangeFilter, FilterSelect, Pagination, presetRange, type DateRange } from "@/components/shared/filters";
import { EmptyState, ErrorState, LoadingRows } from "@/components/shared/states";
import { CategoryBadge, ProcessingBadge, SimulatedBadge, ToneBadge } from "@/components/shared/badges";
import { CATEGORY_LABELS, formatDateTime, formatDuration, formatHours, formatTime } from "@/components/shared/format";

interface ActivityRow {
  id: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  activityCategory: string;
  isBillable: boolean;
  isContextSwitch: boolean;
  isSimulated: boolean;
  user: { id: string; displayName: string };
  project: { id: string; name: string } | null;
  tool: { id: string; name: string } | null;
  file: { fileName: string; fileType: string | null } | null;
  device: { name: string };
}
interface RawRow {
  id: string;
  clientEventId: string;
  eventType: string;
  eventTimestamp: string;
  receivedAt: string;
  processedAt: string | null;
  processingStatus: string;
  attempts: number;
  lastError: string | null;
  isSimulated: boolean;
  payload: unknown;
  user: { displayName: string };
}

export function ActivityView({ showEmployeeFilter, canSeeRaw }: { showEmployeeFilter: boolean; canSeeRaw: boolean }) {
  return (
    <div>
      <PageHeader title="Activity explorer" description="Normalized activity intervals reconstructed by the event worker. You only see records your role permits." actions={<SimulatedBadge />} />
      {canSeeRaw ? (
        <Tabs defaultValue="timeline">
          <TabsList className="mb-4">
            <TabsTrigger value="timeline">Activity timeline</TabsTrigger>
            <TabsTrigger value="raw">Raw events &amp; processing</TabsTrigger>
          </TabsList>
          <TabsContent value="timeline">
            <Timeline showEmployeeFilter={showEmployeeFilter} />
          </TabsContent>
          <TabsContent value="raw">
            <RawEvents />
          </TabsContent>
        </Tabs>
      ) : (
        <Timeline showEmployeeFilter={showEmployeeFilter} />
      )}
    </div>
  );
}

function Timeline({ showEmployeeFilter }: { showEmployeeFilter: boolean }) {
  const [range, setRange] = useState<DateRange>(presetRange(7));
  const [userId, setUserId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [toolId, setToolId] = useState("");
  const [category, setCategory] = useState("");
  const [billable, setBillable] = useState("");
  const [page, setPage] = useState(1);
  const q = { ...range, userId, projectId, toolId, category, billable, page, pageSize: 25 };
  const list = useApi<Page<ActivityRow> & { totalSeconds: number }>(["activity", q], `/api/activity${qs(q)}`);
  const users = useApi<Page<{ id: string; displayName: string }>>(["directory"], showEmployeeFilter ? "/api/employees?pageSize=200" : null);
  const projects = useApi<Page<{ id: string; name: string }>>(["projects-all"], "/api/projects?pageSize=200");
  const tools = useApi<{ id: string; name: string }[]>(["tools"], "/api/tools");
  const reset = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setPage(1);
  };

  return (
    <Card className="gap-0 py-4">
      <CardContent className="px-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <DateRangeFilter value={range} onChange={(r) => { setRange(r); setPage(1); }} />
          {showEmployeeFilter && <FilterSelect label="Employee" value={userId} onChange={reset(setUserId)} allLabel="All employees" options={(users.data?.items ?? []).map((u) => ({ value: u.id, label: u.displayName }))} />}
          <FilterSelect label="Project" value={projectId} onChange={reset(setProjectId)} allLabel="All projects" options={(projects.data?.items ?? []).map((p) => ({ value: p.id, label: p.name }))} />
          <FilterSelect label="Tool" value={toolId} onChange={reset(setToolId)} allLabel="All tools" className="w-[160px]" options={(tools.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />
          <FilterSelect label="Category" value={category} onChange={reset(setCategory)} allLabel="All categories" className="w-[160px]" options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))} />
          <FilterSelect label="Billable" value={billable} onChange={reset(setBillable)} allLabel="Billable + non" className="w-[150px]" options={[{ value: "true", label: "Billable" }, { value: "false", label: "Non-billable" }]} />
        </div>
        {list.error ? (
          <ErrorState message={list.error.message} onRetry={() => list.refetch()} />
        ) : list.isLoading ? (
          <LoadingRows rows={10} />
        ) : list.data!.items.length === 0 ? (
          <EmptyState title="No activity matches these filters" description="Widen the date range or run the simulator." />
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              {list.data!.total} intervals · {formatHours(list.data!.totalSeconds)} total
            </p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Start</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Tool</TableHead>
                    <TableHead>File (metadata)</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead>Billable</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.data!.items.map((a) => (
                    <TableRow key={a.id} className="text-sm">
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(a.startedAt)}–{formatTime(a.endedAt).slice(0, 5)}
                        {a.isContextSwitch && <ToneBadge tone="warning" className="ml-2 px-1 py-0 text-[10px]">switch</ToneBadge>}
                      </TableCell>
                      <TableCell>{a.user.displayName}</TableCell>
                      <TableCell>
                        <CategoryBadge category={a.activityCategory} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">{a.tool?.name ?? "—"}</TableCell>
                      <TableCell className="max-w-[180px] truncate text-xs text-muted-foreground">{a.file?.fileName ?? "—"}</TableCell>
                      <TableCell className="max-w-[160px] truncate">{a.project?.name ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                      <TableCell className="tabular text-right">{formatDuration(a.durationSeconds)}</TableCell>
                      <TableCell>{a.isBillable ? <ToneBadge tone="success">Billable</ToneBadge> : <ToneBadge>Non-billable</ToneBadge>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination page={page} pageSize={25} total={list.data!.total} onPage={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RawEvents() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const list = useApi<Page<RawRow> & { statusCounts: Record<string, number> }>(["raw-events", status, page], `/api/activity/raw${qs({ status, page, pageSize: 25 })}`, { refetchInterval: 5000 });
  const retry = useApiMutation<Record<string, never>, { retried: number }>("POST", "/api/activity/raw/retry", {
    success: (r) => `${r.retried} failed event(s) re-queued`,
    invalidate: [["raw-events"]],
  });
  const counts = list.data?.statusCounts ?? {};
  return (
    <Card className="gap-0 py-4">
      <CardContent className="px-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <FilterSelect label="Processing status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} allLabel="All statuses" options={["PENDING", "PROCESSING", "RETRYING", "PROCESSED", "FAILED", "SKIPPED"].map((s) => ({ value: s, label: `${s.toLowerCase()} (${counts[s] ?? 0})` }))} />
          <div className="flex flex-wrap gap-1.5 text-xs">
            {Object.entries(counts).map(([s, n]) => (
              <span key={s} className="flex items-center gap-1">
                <ProcessingBadge status={s} /> <span className="tabular">{n}</span>
              </span>
            ))}
          </div>
          <Button variant="outline" size="sm" className="ml-auto" disabled={!counts.FAILED || retry.isPending} onClick={() => retry.mutate({})}>
            <RotateCw /> Retry failed
          </Button>
        </div>
        {list.error ? (
          <ErrorState message={list.error.message} />
        ) : list.isLoading ? (
          <LoadingRows rows={10} />
        ) : list.data!.items.length === 0 ? (
          <EmptyState title="No raw events" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Received</TableHead>
                    <TableHead>Event time</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Attempts</TableHead>
                    <TableHead>Payload (JSONB)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.data!.items.map((r) => (
                    <TableRow key={r.id} className="text-xs">
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(r.receivedAt)}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatTime(r.eventTimestamp)}</TableCell>
                      <TableCell>{r.user.displayName}</TableCell>
                      <TableCell className="font-mono text-[11px]">{r.eventType}</TableCell>
                      <TableCell>
                        <span title={r.lastError ?? undefined}>
                          <ProcessingBadge status={r.processingStatus} />
                        </span>
                      </TableCell>
                      <TableCell className="tabular text-right">{r.attempts}</TableCell>
                      <TableCell>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="ghost" size="xs">
                              View
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-96">
                            <pre className="scrollbar-thin max-h-72 overflow-auto text-[11px] leading-relaxed">{JSON.stringify(r.payload, null, 2)}</pre>
                            {r.lastError && <p className="mt-2 text-[11px] text-destructive">{r.lastError}</p>}
                          </PopoverContent>
                        </Popover>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination page={page} pageSize={25} total={list.data!.total} onPage={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
