"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApi } from "@/hooks/use-api";
import { qs } from "@/lib/api/client";
import { PageHeader } from "@/components/shared/page-header";
import { DateRangeFilter, FilterSelect, Pagination, presetRange, type DateRange } from "@/components/shared/filters";
import { EmptyState, ErrorState, LoadingRows } from "@/components/shared/states";
import { formatDateTime } from "@/components/shared/format";

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  projectId: string | null;
  metadata: Record<string, unknown>;
  requestId: string | null;
  createdAt: string;
  actor: { id: string; displayName: string; email: string } | null;
}

export function AuditView({ scopeNote }: { scopeNote: string }) {
  const [range, setRange] = useState<DateRange>(presetRange(30));
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [page, setPage] = useState(1);
  const q = { ...range, action, entityType, page, pageSize: 30 };
  const list = useApi<{ items: AuditRow[]; total: number; entityTypes: string[] }>(["audit", q], `/api/audit-logs${qs(q)}`);

  return (
    <div>
      <PageHeader title="Audit logs" description={`Append-only record of security, configuration and billing events. ${scopeNote}`} />
      <Card className="gap-0 py-4">
        <CardContent className="px-4">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <DateRangeFilter value={range} onChange={(r) => { setRange(r); setPage(1); }} />
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input placeholder="Action contains… e.g. timesheet" className="h-9 w-[220px] pl-8" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Filter by action" />
            </div>
            <FilterSelect label="Entity type" value={entityType} onChange={(v) => { setEntityType(v); setPage(1); }} allLabel="All entities" options={(list.data?.entityTypes ?? []).map((e) => ({ value: e, label: e }))} />
          </div>
          {list.error ? (
            <ErrorState message={list.error.message} onRetry={() => list.refetch()} />
          ) : list.isLoading ? (
            <LoadingRows rows={10} />
          ) : list.data!.items.length === 0 ? (
            <EmptyState title="No audit records match these filters" />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Entity</TableHead>
                      <TableHead>Request</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.data!.items.map((a) => (
                      <TableRow key={a.id} className="text-xs" data-testid="audit-row">
                        <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(a.createdAt)}</TableCell>
                        <TableCell>{a.actor ? a.actor.displayName : <span className="text-muted-foreground">System</span>}</TableCell>
                        <TableCell className="font-mono text-[11px] text-primary">{a.action}</TableCell>
                        <TableCell>
                          {a.entityType}
                          {a.entityId && <span className="ml-1 font-mono text-[10px] text-muted-foreground">{a.entityId.slice(0, 8)}</span>}
                        </TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground">{a.requestId?.slice(0, 8) ?? "—"}</TableCell>
                        <TableCell>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="ghost" size="xs">
                                View
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-96">
                              <pre className="scrollbar-thin max-h-72 overflow-auto text-[11px] leading-relaxed">{JSON.stringify(a.metadata, null, 2)}</pre>
                            </PopoverContent>
                          </Popover>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Pagination page={page} pageSize={30} total={list.data!.total} onPage={setPage} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
