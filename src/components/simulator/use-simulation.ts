"use client";

/**
 * Simulation engine for the in-browser SIMULATED desktop agent.
 *
 * - One controlled timer (250 ms). Starting always clears any previous
 *   timer, so duplicate timers / runaway generation are impossible.
 * - Simulated clock advances `speed`× real time and freezes while paused.
 * - Accelerated runs are back-dated: the simulated timeline is anchored at
 *   now − duration × (1 − 1/speed), so it ends at the real current time and
 *   no event is ever future-dated.
 * - Events are submitted in order, one request at a time, in batches, through
 *   the authenticated /api/simulator/events endpoint (same ingestion path as a
 *   real collector). Nothing is written to normalized tables from here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiSend } from "@/lib/api/client";
import { expandScenario, getScenario, scenarioDurationMs, type Actor, type GeneratedEvent, type ScenarioId } from "@/lib/simulator/scenarios";
import type { ActivityEventInput, FileMetadata } from "@/lib/validation/events";

export type SimStatus = "idle" | "running" | "paused" | "stopping" | "stopped" | "completed";

export interface SimConfig {
  runId: string;
  scenario: ScenarioId;
  speed: number;
  projectId: string | null;
  primary: { userId: string; deviceId: string };
  partner?: { userId: string; deviceId: string };
  idleTimeoutSeconds: number;
  /** Pre-planned events (see planScenario). */
  generated: GeneratedEvent[];
  /** Latest free window end from the server (accelerated runs are back-dated before it). */
  timelineEndMs?: number;
}

/** Build a scenario's concrete event plan (randomized slightly per run). */
export function planScenario(scenario: ScenarioId, projectId: string | null, idleTimeoutSeconds: number, withPartner: boolean): GeneratedEvent[] {
  const def = getScenario(scenario);
  const steps = def.build({ projectKey: (projectId ?? "unassigned").slice(0, 8), rand: Math.random, scale: 1 });
  return expandScenario(steps, { projectId, heartbeatSeconds: 60, idleTimeoutSeconds }).filter((e) => e.actor === "primary" || withPartner);
}

export interface LogEntry {
  eventId: string;
  actor: Actor;
  type: string;
  timestamp: string;
  tool?: string;
  file?: string;
  ingest: "queued" | "sending" | "accepted" | "duplicate" | "rejected" | "error";
  message?: string;
}

interface PlannedEvent extends GeneratedEvent {
  eventId: string;
  sessionId: string;
  deviceId: string;
  userId: string;
}

export interface AgentState {
  focused: boolean;
  idle: boolean;
  tool: string | null;
  file: FileMetadata | null;
  projectId: string | null;
  sessionId: string | null;
  sessionStartedAt: number | null;
}

const initialAgent: AgentState = { focused: false, idle: false, tool: null, file: null, projectId: null, sessionId: null, sessionStartedAt: null };

export function useSimulation() {
  const [status, setStatus] = useState<SimStatus>("idle");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [agent, setAgent] = useState<AgentState>(initialAgent);
  const [progress, setProgress] = useState({ simNow: 0, elapsedMs: 0, durationMs: 0, generated: 0, accepted: 0, duplicates: 0, rejected: 0 });
  const [config, setConfig] = useState<SimConfig | null>(null);

  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const plan = useRef<PlannedEvent[]>([]);
  const cursor = useRef(0);
  const anchor = useRef(0); // epoch ms of scenario offset 0
  const elapsed = useRef(0); // simulated ms since anchor
  const lastReal = useRef(0);
  const statusRef = useRef<SimStatus>("idle");
  const cfg = useRef<SimConfig | null>(null);
  const queue = useRef<PlannedEvent[]>([]);
  const inFlight = useRef(false);
  const counters = useRef({ generated: 0, accepted: 0, duplicates: 0, rejected: 0 });
  const ended = useRef<Record<Actor, boolean>>({ primary: false, partner: false });
  const agentRef = useRef<AgentState>(initialAgent);

  const setStatusBoth = (s: SimStatus) => {
    statusRef.current = s;
    setStatus(s);
  };

  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const updateLog = (ids: string[], patch: Partial<LogEntry> | ((e: LogEntry) => Partial<LogEntry>)) => {
    const set = new Set(ids);
    setLog((prev) => prev.map((e) => (set.has(e.eventId) ? { ...e, ...(typeof patch === "function" ? patch(e) : patch) } : e)));
  };

  const toInput = (e: PlannedEvent): ActivityEventInput => ({
    eventId: e.eventId,
    type: e.type,
    timestamp: new Date(anchor.current + e.offsetMs).toISOString(),
    deviceId: e.deviceId,
    sessionId: e.sessionId,
    sequence: e.sequence,
    ...(e.projectId !== undefined ? { projectId: e.projectId } : {}),
    ...(e.tool ? { tool: e.tool } : {}),
    ...(e.file !== undefined ? { file: e.file } : {}),
    ...(e.idleSeconds !== undefined ? { idleSeconds: e.idleSeconds } : {}),
    simulated: true,
  });

  /** Send queued events in order, one request at a time. */
  const flush = useCallback(async () => {
    if (inFlight.current || queue.current.length === 0 || !cfg.current) return;
    inFlight.current = true;
    try {
      while (queue.current.length > 0) {
        const actor = queue.current[0].actor;
        const batch: PlannedEvent[] = [];
        while (queue.current.length && queue.current[0].actor === actor && batch.length < 150) batch.push(queue.current.shift()!);
        const ids = batch.map((b) => b.eventId);
        updateLog(ids, { ingest: "sending" });
        try {
          const res = await apiSend<{ results: { eventId: string; status: "accepted" | "duplicate" | "rejected"; message?: string }[] }>(
            "/api/simulator/events",
            "POST",
            { runId: cfg.current.runId, userId: batch[0].userId, events: batch.map(toInput) },
          );
          const byId = new Map(res.results.map((r) => [r.eventId, r]));
          for (const r of res.results) {
            if (r.status === "accepted") counters.current.accepted++;
            else if (r.status === "duplicate") counters.current.duplicates++;
            else counters.current.rejected++;
          }
          updateLog(ids, (e) => ({ ingest: byId.get(e.eventId)?.status ?? "error", message: byId.get(e.eventId)?.message }));
        } catch (err) {
          counters.current.rejected += batch.length;
          updateLog(ids, { ingest: "error", message: (err as Error).message });
          // Consent withdrawn / run ended / unauthorized: stop generating.
          const status = (err as { status?: number }).status;
          if (status && [401, 403, 404, 409].includes(status)) {
            queue.current = [];
            clearTimer();
            setStatusBoth("stopped");
          }
        }
        setProgress((p) => ({ ...p, ...counters.current }));
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  const applyToAgent = (e: PlannedEvent) => {
    if (e.actor !== "primary") return;
    const a = { ...agentRef.current };
    switch (e.type) {
      case "FOCUS_STARTED":
        a.focused = true;
        a.idle = false;
        a.sessionId = e.sessionId;
        a.sessionStartedAt = anchor.current + e.offsetMs;
        break;
      case "FOCUS_ENDED":
        a.focused = false;
        a.idle = false;
        break;
      case "IDLE_STARTED":
        a.idle = true;
        break;
      case "IDLE_ENDED":
        a.idle = false;
        break;
      case "APP_CLOSED":
        a.tool = null;
        break;
    }
    if (e.tool && e.type !== "APP_CLOSED") a.tool = e.tool;
    if (e.file !== undefined) a.file = e.file;
    if (e.projectId !== undefined) a.projectId = e.projectId;
    agentRef.current = a;
  };

  const dispatch = (events: PlannedEvent[]) => {
    if (events.length === 0) return;
    for (const e of events) {
      applyToAgent(e);
      if (e.type === "FOCUS_ENDED") ended.current[e.actor] = true;
    }
    counters.current.generated += events.length;
    queue.current.push(...events);
    setAgent(agentRef.current);
    setLog((prev) =>
      [
        ...events
          .map<LogEntry>((e) => ({
            eventId: e.eventId,
            actor: e.actor,
            type: e.type,
            timestamp: new Date(anchor.current + e.offsetMs).toISOString(),
            tool: e.tool,
            file: e.file?.name,
            ingest: "queued",
          }))
          .reverse(),
        ...prev,
      ].slice(0, 300),
    );
    void flush();
  };

  const tick = useCallback(() => {
    const c = cfg.current;
    if (!c) return;
    const now = Date.now();
    if (statusRef.current === "running") {
      elapsed.current += (now - lastReal.current) * c.speed;
      const due: PlannedEvent[] = [];
      while (cursor.current < plan.current.length && plan.current[cursor.current].offsetMs <= elapsed.current) {
        due.push(plan.current[cursor.current++]);
      }
      dispatch(due);
      const durationMs = scenarioDurationMs(plan.current);
      setProgress((p) => ({ ...p, simNow: anchor.current + Math.min(elapsed.current, durationMs), elapsedMs: Math.min(elapsed.current, durationMs), durationMs }));
      if (cursor.current >= plan.current.length && queue.current.length === 0 && !inFlight.current) {
        clearTimer();
        setStatusBoth("completed");
        apiSend(`/api/simulator/runs/${c.runId}`, "PATCH", { status: "COMPLETED" }).catch(() => undefined);
      }
    }
    lastReal.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback((config: SimConfig) => {
    clearTimer();
    const generated = config.generated;
    const sessions: Record<Actor, string> = { primary: crypto.randomUUID(), partner: crypto.randomUUID() };
    plan.current = generated
      .filter((e) => e.actor === "primary" || config.partner)
      .map((e) => ({
        ...e,
        eventId: crypto.randomUUID(),
        sessionId: sessions[e.actor],
        deviceId: e.actor === "primary" ? config.primary.deviceId : config.partner!.deviceId,
        userId: e.actor === "primary" ? config.primary.userId : config.partner!.userId,
      }));
    const durationMs = scenarioDurationMs(plan.current);
    // Back-date accelerated runs so the timeline ends no later than now, and
    // never on top of the employee's recent activity (server-provided window).
    const backdated = Date.now() - durationMs * (1 - 1 / config.speed);
    anchor.current = config.speed > 1 && config.timelineEndMs ? Math.min(backdated, config.timelineEndMs - durationMs) : backdated;
    elapsed.current = 0;
    cursor.current = 0;
    queue.current = [];
    counters.current = { generated: 0, accepted: 0, duplicates: 0, rejected: 0 };
    ended.current = { primary: false, partner: !config.partner };
    agentRef.current = initialAgent;
    cfg.current = config;
    setConfig(config);
    setAgent(initialAgent);
    setLog([]);
    setProgress({ simNow: anchor.current, elapsedMs: 0, durationMs, generated: 0, accepted: 0, duplicates: 0, rejected: 0 });
    lastReal.current = Date.now();
    setStatusBoth("running");
    timer.current = setInterval(tick, 250);
    tick();
  }, [tick]);

  const pause = useCallback(() => {
    if (statusRef.current !== "running" || !cfg.current) return;
    setStatusBoth("paused");
    apiSend(`/api/simulator/runs/${cfg.current.runId}`, "PATCH", { status: "PAUSED" }).catch(() => undefined);
  }, []);

  const resume = useCallback(() => {
    if (statusRef.current !== "paused" || !cfg.current) return;
    lastReal.current = Date.now();
    setStatusBoth("running");
    apiSend(`/api/simulator/runs/${cfg.current.runId}`, "PATCH", { status: "RUNNING" }).catch(() => undefined);
  }, []);

  /** Stop: close any open session with FOCUS_ENDED at the current simulated time, then end the run. */
  const stop = useCallback(async () => {
    const c = cfg.current;
    if (!c || !["running", "paused"].includes(statusRef.current)) return;
    clearTimer();
    setStatusBoth("stopping");
    const closing: PlannedEvent[] = [];
    for (const actor of ["primary", "partner"] as Actor[]) {
      if (ended.current[actor]) continue;
      const started = plan.current.slice(0, cursor.current).some((e) => e.actor === actor);
      if (!started) continue;
      const seq = Math.max(0, ...plan.current.filter((e) => e.actor === actor).map((e) => e.sequence)) + 1;
      const base = plan.current.find((e) => e.actor === actor)!;
      closing.push({ ...base, type: "FOCUS_ENDED", offsetMs: Math.round(elapsed.current), sequence: seq, eventId: crypto.randomUUID(), tool: undefined, file: undefined, projectId: undefined, idleSeconds: undefined });
    }
    cursor.current = plan.current.length;
    dispatch(closing);
    // Wait for in-flight submissions to finish before marking the run stopped.
    for (let i = 0; i < 40 && (inFlight.current || queue.current.length > 0); i++) await new Promise((r) => setTimeout(r, 150));
    await apiSend(`/api/simulator/runs/${c.runId}`, "PATCH", { status: "STOPPED" }).catch(() => undefined);
    setStatusBoth("stopped");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    plan.current = [];
    queue.current = [];
    cursor.current = 0;
    elapsed.current = 0;
    cfg.current = null;
    agentRef.current = initialAgent;
    setConfig(null);
    setAgent(initialAgent);
    setLog([]);
    setProgress({ simNow: 0, elapsedMs: 0, durationMs: 0, generated: 0, accepted: 0, duplicates: 0, rejected: 0 });
    setStatusBoth("idle");
  }, []);

  // Never leave a timer running after unmount.
  useEffect(() => () => clearTimer(), []);

  return { status, log, agent, progress, config, start, pause, resume, stop, reset };
}
