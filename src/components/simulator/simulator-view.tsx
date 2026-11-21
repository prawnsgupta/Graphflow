"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CircleDot, FileText, FlaskConical, Laptop, Moon, Pause, Play, Plus, RotateCcw, Square, Timer, Zap } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApi } from "@/hooks/use-api";
import { apiSend } from "@/lib/api/client";
import { SCENARIOS, SIMULATION_SPEEDS, type ScenarioId } from "@/lib/simulator/scenarios";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingRows } from "@/components/shared/states";
import { ProcessingBadge, ToneBadge } from "@/components/shared/badges";
import { formatDuration, formatTime } from "@/components/shared/format";
import { planScenario, useSimulation } from "./use-simulation";
import { scenarioDurationMs } from "@/lib/simulator/scenarios";
import { cn } from "@/lib/utils";

interface Options {
  users: {
    id: string;
    displayName: string;
    role: string;
    trackingConsent: boolean;
    devices: { id: string; name: string; isSimulated: boolean }[];
    projects: { id: string; name: string }[];
  }[];
  settings: { idleTimeoutMinutes: number; heartbeatTimeoutMinutes: number };
}

interface RunStats {
  counts: { total: number; processed: number; pending: number; failed: number; skipped: number };
  recent: { eventId: string; type: string; status: string; error: string | null }[];
  session: { id: string; status: string; trackedSeconds: number; activeSeconds: number; idleSeconds: number; deepFocusSeconds: number; contextSwitchCount: number } | null;
}

const UNASSIGNED = "__unassigned__";

export function SimulatorView({ currentUserId }: { currentUserId: string }) {
  const options = useApi<Options>(["sim-options"], "/api/simulator/options");
  const sim = useSimulation();
  const [userId, setUserId] = useState(currentUserId);
  const [deviceId, setDeviceId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [scenario, setScenario] = useState<ScenarioId>("DEEP_DESIGN");
  const [speed, setSpeed] = useState(60);
  const [partnerId, setPartnerId] = useState("");
  const [starting, setStarting] = useState(false);

  const users = useMemo(() => options.data?.users ?? [], [options.data]);
  const user = users.find((u) => u.id === userId);
  const def = SCENARIOS.find((s) => s.id === scenario)!;
  const partnerCandidates = useMemo(
    () => users.filter((u) => u.id !== userId && u.trackingConsent && projectId && u.projects.some((p) => p.id === projectId) && u.devices.length > 0),
    [users, userId, projectId],
  );
  const partner = users.find((u) => u.id === partnerId);
  const active = sim.status === "running" || sim.status === "paused" || sim.status === "stopping";

  // Defaults when the employee changes.
  useEffect(() => {
    if (!user) return;
    if (!user.devices.some((d) => d.id === deviceId)) setDeviceId(user.devices[0]?.id ?? "");
    if (projectId !== UNASSIGNED && !user.projects.some((p) => p.id === projectId)) setProjectId(user.projects[0]?.id ?? UNASSIGNED);
  }, [user, deviceId, projectId]);
  useEffect(() => {
    if (!partnerCandidates.some((p) => p.id === partnerId)) setPartnerId(partnerCandidates[0]?.id ?? "");
  }, [partnerCandidates, partnerId]);

  const runId = sim.config?.runId;
  const stats = useApi<RunStats>(["sim-run", runId], runId ? `/api/simulator/runs/${runId}` : null, {
    refetchInterval: runId ? 1500 : false,
  });
  const processingById = useMemo(() => new Map((stats.data?.recent ?? []).map((r) => [r.eventId, r])), [stats.data]);

  const registerDevice = async () => {
    try {
      const n = (user?.devices.length ?? 0) + 1;
      await apiSend("/api/devices", "POST", { name: `Simulated Workstation ${n}`, userId, isSimulated: true, platform: "web-simulator" });
      toast.success("Simulated device registered");
      await options.refetch();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const start = async () => {
    if (!user || !deviceId) return;
    setStarting(true);
    try {
      const pid = projectId === UNASSIGNED ? null : projectId;
      const partnerDevice = partner?.devices[0]?.id;
      const idleTimeoutSeconds = (options.data?.settings.idleTimeoutMinutes ?? 5) * 60;
      const generated = planScenario(scenario, pid, idleTimeoutSeconds, def.requiresPartner && !!partnerDevice);
      const run = await apiSend<{ id: string; timelineEnd: string }>("/api/simulator/runs", "POST", {
        durationMs: scenarioDurationMs(generated),
        userId,
        deviceId,
        projectId: pid,
        scenario,
        speed,
        ...(def.requiresPartner ? { partnerUserId: partnerId, partnerDeviceId: partnerDevice } : {}),
      });
      sim.start({
        runId: run.id,
        scenario,
        speed,
        projectId: pid,
        primary: { userId, deviceId },
        partner: def.requiresPartner && partnerDevice ? { userId: partnerId, deviceId: partnerDevice } : undefined,
        idleTimeoutSeconds,
        generated,
        timelineEndMs: Date.parse(run.timelineEnd),
      });
      toast.success("Simulation started — events are flowing through the ingestion API");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  if (options.error) return <ErrorState message={options.error.message} onRetry={() => options.refetch()} />;

  const pct = sim.progress.durationMs ? Math.min(100, (sim.progress.elapsedMs / sim.progress.durationMs) * 100) : 0;
  const counts = stats.data?.counts;
  const canStart = !!user && !!deviceId && user.trackingConsent && (!def.requiresPartner || (!!partnerId && projectId !== UNASSIGNED)) && !active;

  return (
    <div>
      <PageHeader
        title="Activity simulator"
        description="A simulated desktop agent. Every event goes through the authenticated ingestion API, PostgreSQL, Redis/BullMQ and the background worker — exactly like a real collector."
      />

      <div className="mb-6 flex items-start gap-3 rounded-lg border-2 border-warning/40 bg-warning/10 px-4 py-3">
        <FlaskConical className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="text-sm">
          <p className="font-semibold uppercase tracking-wide text-warning">Simulated data</p>
          <p className="text-xs text-muted-foreground">
            This simulator generates operational metadata only (application, project, file name, idle state). It does not observe your real computer, and it never captures screenshots, keystrokes, clipboard, messages, page or file contents. All generated events are labelled simulated.
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <Card className="gap-4 py-5">
          <CardHeader className="px-5">
            <CardTitle className="text-sm">Configuration</CardTitle>
            <CardDescription className="text-xs">Choose who, where and what to simulate.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-5">
            {options.isLoading ? (
              <LoadingRows rows={5} />
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>Employee</Label>
                  <Select value={userId} onValueChange={setUserId} disabled={active}>
                    <SelectTrigger className="w-full" aria-label="Employee">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.displayName}
                          {u.id === currentUserId ? " (you)" : ""}
                          {!u.trackingConsent ? " — no consent" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {user && !user.trackingConsent && (
                    <p className="text-xs text-warning">
                      This employee has not granted tracking consent, so events would be rejected.{" "}
                      {user.id === currentUserId && (
                        <Link href="/settings?tab=consent" className="underline">
                          Grant consent
                        </Link>
                      )}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>Device</Label>
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={registerDevice} disabled={active}>
                      <Plus className="size-3" /> Register device
                    </Button>
                  </div>
                  <Select value={deviceId} onValueChange={setDeviceId} disabled={active || !user?.devices.length}>
                    <SelectTrigger className="w-full" aria-label="Device">
                      <SelectValue placeholder="No devices — register one" />
                    </SelectTrigger>
                    <SelectContent>
                      {user?.devices.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Project</Label>
                  <Select value={projectId} onValueChange={setProjectId} disabled={active}>
                    <SelectTrigger className="w-full" aria-label="Project">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {user?.projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                      <SelectItem value={UNASSIGNED}>Unassigned (no project)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Activity scenario</Label>
                  <Select value={scenario} onValueChange={(v) => setScenario(v as ScenarioId)} disabled={active}>
                    <SelectTrigger className="w-full" aria-label="Scenario">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCENARIOS.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{def.description}</p>
                </div>
                {def.requiresPartner && (
                  <div className="space-y-1.5">
                    <Label>Collaboration partner</Label>
                    <Select value={partnerId} onValueChange={setPartnerId} disabled={active || partnerCandidates.length === 0}>
                      <SelectTrigger className="w-full" aria-label="Partner">
                        <SelectValue placeholder="No eligible partner" />
                      </SelectTrigger>
                      <SelectContent>
                        {partnerCandidates.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {partnerCandidates.length === 0
                        ? "Needs a second consenting employee on the same project that you are allowed to simulate for (managers and admins)."
                        : "Both users' events are submitted; the worker links overlapping project sessions."}
                    </p>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>Simulation speed</Label>
                  <Select value={String(speed)} onValueChange={(v) => setSpeed(Number(v))} disabled={active}>
                    <SelectTrigger className="w-full" aria-label="Speed">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SIMULATION_SPEEDS.map((s) => (
                        <SelectItem key={s.value} value={String(s.value)}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {speed > 1 && <p className="text-xs text-muted-foreground">Accelerated runs are back-dated so the simulated timeline ends at the current time.</p>}
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  {sim.status === "paused" ? (
                    <Button onClick={sim.resume}>
                      <Play /> Resume
                    </Button>
                  ) : (
                    <Button onClick={start} disabled={!canStart || starting} data-testid="sim-start">
                      <Play /> {starting ? "Starting…" : "Start"}
                    </Button>
                  )}
                  <Button variant="outline" onClick={sim.pause} disabled={sim.status !== "running"}>
                    <Pause /> Pause
                  </Button>
                  <Button variant="outline" onClick={() => void sim.stop()} disabled={!(sim.status === "running" || sim.status === "paused")}>
                    <Square /> Stop
                  </Button>
                  <Button variant="ghost" onClick={sim.reset} disabled={active}>
                    <RotateCcw /> Reset
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="gap-4 py-5">
            <CardHeader className="flex flex-row items-center justify-between px-5">
              <CardTitle className="flex items-center gap-2 text-sm">
                <CircleDot className={cn("size-4", sim.status === "running" ? "animate-pulse text-success" : "text-muted-foreground")} />
                Agent status
              </CardTitle>
              <div className="flex items-center gap-2">
                <ToneBadge tone="warning" className="uppercase">Simulated</ToneBadge>
                <ToneBadge tone={sim.status === "running" ? "success" : sim.status === "paused" ? "warning" : sim.status === "completed" ? "primary" : "neutral"}>
                  <span data-testid="sim-status">{sim.status}</span>
                </ToneBadge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 px-5">
              <div>
                <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                  <span>
                    Simulated clock {sim.progress.simNow ? formatTime(new Date(sim.progress.simNow)) : "—"} · {sim.config ? `${sim.config.speed}x` : ""}
                  </span>
                  <span className="tabular">
                    {formatDuration(sim.progress.elapsedMs / 1000)} / {formatDuration(sim.progress.durationMs / 1000)}
                  </span>
                </div>
                <Progress value={pct} className="h-1.5" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatusTile icon={Laptop} label="Current active tool" value={sim.agent.tool ?? "—"} />
                <StatusTile icon={FileText} label="Current file (metadata)" value={sim.agent.file?.name ?? "—"} sub={sim.agent.file?.path} />
                <StatusTile
                  icon={Timer}
                  label="Current focus session"
                  value={sim.agent.focused ? "Focused" : sim.agent.sessionId ? "Ended" : "—"}
                  sub={sim.agent.sessionId ? `session ${sim.agent.sessionId.slice(0, 8)}` : undefined}
                />
                <StatusTile icon={Moon} label="Idle state" value={sim.agent.idle ? "Idle" : sim.agent.focused ? "Active" : "—"} tone={sim.agent.idle ? "warning" : undefined} />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Counter label="Events generated" value={sim.progress.generated} testId="sim-generated" />
                <Counter label="Successfully processed" value={counts?.processed ?? 0} tone="success" testId="sim-processed" />
                <Counter label="Pending" value={counts?.pending ?? 0} tone="warning" testId="sim-pending" />
                <Counter label="Failed / rejected" value={(counts?.failed ?? 0) + sim.progress.rejected} tone="danger" testId="sim-failed" />
              </div>
              {stats.data?.session && (
                <div className="rounded-md border border-border bg-surface-2/40 p-3 text-xs">
                  <p className="mb-2 flex items-center gap-1.5 font-medium">
                    <Zap className="size-3.5 text-primary" /> Backend session reconstruction (from the worker)
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <Mini label="Status" value={stats.data.session.status} />
                    <Mini label="Tracked" value={formatDuration(stats.data.session.trackedSeconds)} />
                    <Mini label="Idle" value={formatDuration(stats.data.session.idleSeconds)} />
                    <Mini label="Deep focus" value={formatDuration(stats.data.session.deepFocusSeconds)} />
                    <Mini label="Context switches" value={String(stats.data.session.contextSwitchCount)} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="gap-3 py-4">
            <CardHeader className="flex flex-row items-center justify-between px-5">
              <CardTitle className="text-sm">Event log</CardTitle>
              <span className="text-xs text-muted-foreground">
                accepted {sim.progress.accepted} · duplicates {sim.progress.duplicates} · rejected {sim.progress.rejected}
              </span>
            </CardHeader>
            <CardContent className="px-2 sm:px-5">
              <div className="scrollbar-thin max-h-[420px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sim time</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead>Tool / file</TableHead>
                      <TableHead>Ingestion</TableHead>
                      <TableHead>Processing</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sim.log.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="py-10 text-center text-xs text-muted-foreground">
                          Start a simulation to see events as they are generated and processed.
                        </TableCell>
                      </TableRow>
                    )}
                    {sim.log.map((e) => {
                      const p = processingById.get(e.eventId);
                      return (
                        <TableRow key={e.eventId} className="text-xs">
                          <TableCell className="tabular whitespace-nowrap text-muted-foreground">{formatTime(e.timestamp)}</TableCell>
                          <TableCell className="text-muted-foreground">{e.actor === "partner" ? "partner" : "primary"}</TableCell>
                          <TableCell className="font-mono text-[11px]">{e.type}</TableCell>
                          <TableCell className="max-w-[200px] truncate text-muted-foreground">{[e.tool, e.file].filter(Boolean).join(" · ") || "—"}</TableCell>
                          <TableCell>
                            <span title={e.message} className={cn(e.ingest === "accepted" ? "text-success" : e.ingest === "rejected" || e.ingest === "error" ? "text-destructive" : "text-muted-foreground")}>
                              {e.ingest}
                            </span>
                          </TableCell>
                          <TableCell>{p ? <ProcessingBadge status={p.status} /> : e.ingest === "accepted" ? <span className="text-muted-foreground">…</span> : "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatusTile({ icon: Icon, label, value, sub, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string; tone?: "warning" }) {
  return (
    <div className="rounded-md border border-border bg-surface-2/40 p-3">
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </p>
      <p className={cn("mt-1 truncate text-sm font-medium", tone === "warning" && "text-warning")}>{value}</p>
      {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Counter({ label, value, tone, testId }: { label: string; value: number; tone?: "success" | "warning" | "danger"; testId?: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p data-testid={testId} className={cn("tabular mt-1 text-xl font-semibold", tone === "success" && "text-success", tone === "warning" && "text-warning", tone === "danger" && "text-destructive")}>
        {value}
      </p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="tabular font-medium">{value}</p>
    </div>
  );
}
