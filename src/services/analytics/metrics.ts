/**
 * Analytics calculations over normalized FocusEvents — pure functions.
 * Every number shown in the dashboards is produced here (or in SQL
 * aggregates) from database records; nothing is hardcoded in the UI.
 */
import type { ActivityCategory } from "@/services/events/classification";
import { pct } from "@/services/billing/billing-math";
import { dateKeyInTz } from "@/lib/utils/time";

export interface MetricEvent {
  userId: string;
  projectId: string | null;
  toolId: string | null;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  category: ActivityCategory;
  isBillable: boolean;
  isContextSwitch: boolean;
}

export interface FrictionSettings {
  contextSwitchThresholdPerHour: number;
  contextSwitchCostSeconds: number;
  fragmentThresholdSeconds: number;
  fragmentMinCountPerHour: number;
}

export const DEFAULT_FRICTION_SETTINGS: FrictionSettings = {
  contextSwitchThresholdPerHour: 6,
  contextSwitchCostSeconds: 120,
  fragmentThresholdSeconds: 120,
  fragmentMinCountPerHour: 3,
};

export interface Totals {
  trackedSeconds: number;
  activeSeconds: number;
  idleSeconds: number;
  deepFocusSeconds: number;
  activeWorkSeconds: number;
  collaborationSeconds: number;
  administrativeSeconds: number;
  unassignedSeconds: number;
  billableSeconds: number;
  nonBillableSeconds: number;
  contextSwitches: number;
  sessionsCount: number;
}

export function emptyTotals(): Totals {
  return {
    trackedSeconds: 0,
    activeSeconds: 0,
    idleSeconds: 0,
    deepFocusSeconds: 0,
    activeWorkSeconds: 0,
    collaborationSeconds: 0,
    administrativeSeconds: 0,
    unassignedSeconds: 0,
    billableSeconds: 0,
    nonBillableSeconds: 0,
    contextSwitches: 0,
    sessionsCount: 0,
  };
}

/**
 * Tracked = every reconstructed interval (active + idle).
 * Active = tracked − idle. Non-billable = tracked − billable.
 */
export function addToTotals(t: Totals, e: MetricEvent): Totals {
  const d = e.durationSeconds;
  t.trackedSeconds += d;
  if (e.category === "IDLE") t.idleSeconds += d;
  else t.activeSeconds += d;
  if (e.category === "DEEP_FOCUS") t.deepFocusSeconds += d;
  if (e.category === "ACTIVE_WORK") t.activeWorkSeconds += d;
  if (e.category === "COLLABORATION") t.collaborationSeconds += d;
  if (e.category === "ADMINISTRATIVE") t.administrativeSeconds += d;
  if (e.category === "UNASSIGNED") t.unassignedSeconds += d;
  if (e.isBillable) t.billableSeconds += d;
  else t.nonBillableSeconds += d;
  if (e.isContextSwitch) t.contextSwitches += 1;
  return t;
}

export function summarize(events: MetricEvent[]): Totals {
  return events.reduce(addToTotals, emptyTotals());
}

export interface FrictionBreakdown {
  idleSeconds: number;
  unassignedSeconds: number;
  excessSwitchSeconds: number;
  fragmentedSeconds: number;
  totalSeconds: number;
}

/**
 * Workflow friction from measurable interruptions (transparent rules):
 *  1. idle time;
 *  2. unassigned (no project) active time;
 *  3. excessive context switching — per user and clock hour, every switch
 *     above the threshold costs `contextSwitchCostSeconds`;
 *  4. repeated interrupted sessions — ACTIVE_WORK fragments shorter than
 *     `fragmentThresholdSeconds`, counted only when at least
 *     `fragmentMinCountPerHour` occur in the same user-hour.
 * Collaboration and administrative work are NOT treated as friction.
 * The total is capped at tracked time.
 */
export function computeFriction(events: MetricEvent[], s: FrictionSettings): FrictionBreakdown {
  let idle = 0;
  let unassigned = 0;
  let tracked = 0;
  const switchesPerHour = new Map<string, number>();
  const fragmentsPerHour = new Map<string, { count: number; seconds: number }>();

  for (const e of events) {
    tracked += e.durationSeconds;
    if (e.category === "IDLE") idle += e.durationSeconds;
    if (e.category === "UNASSIGNED") unassigned += e.durationSeconds;
    const hourKey = `${e.userId}|${Math.floor(e.startedAt.getTime() / 3_600_000)}`;
    if (e.isContextSwitch) switchesPerHour.set(hourKey, (switchesPerHour.get(hourKey) ?? 0) + 1);
    if (e.category === "ACTIVE_WORK" && e.durationSeconds < s.fragmentThresholdSeconds) {
      const f = fragmentsPerHour.get(hourKey) ?? { count: 0, seconds: 0 };
      f.count += 1;
      f.seconds += e.durationSeconds;
      fragmentsPerHour.set(hourKey, f);
    }
  }

  let excessSwitch = 0;
  for (const count of switchesPerHour.values()) {
    excessSwitch += Math.max(0, count - s.contextSwitchThresholdPerHour) * s.contextSwitchCostSeconds;
  }
  let fragmented = 0;
  for (const f of fragmentsPerHour.values()) {
    if (f.count >= s.fragmentMinCountPerHour) fragmented += f.seconds;
  }
  const total = Math.min(tracked, idle + unassigned + excessSwitch + fragmented);
  return { idleSeconds: idle, unassignedSeconds: unassigned, excessSwitchSeconds: excessSwitch, fragmentedSeconds: fragmented, totalSeconds: total };
}

/** Deep Focus Ratio = Deep Focus Seconds / Active Work Seconds × 100 (active = non-idle). */
export const deepFocusRatio = (t: Totals) => pct(t.deepFocusSeconds, t.activeSeconds);
/** Friction Ratio = Friction Seconds / Tracked Seconds × 100. */
export const frictionRatio = (frictionSeconds: number, t: Totals) => pct(frictionSeconds, t.trackedSeconds);

export function averageUninterruptedSeconds(events: MetricEvent[]): number {
  const active = events.filter((e) => e.category !== "IDLE" && e.category !== "UNASSIGNED");
  if (active.length === 0) return 0;
  return Math.round(active.reduce((s, e) => s + e.durationSeconds, 0) / active.length);
}

export function switchesPerActiveHour(t: Totals): number {
  if (!t.activeSeconds) return 0;
  return Math.round((t.contextSwitches / (t.activeSeconds / 3600)) * 10) / 10;
}

/** Group events into local-date buckets in the organization's timezone. */
export function groupByDay(events: MetricEvent[], tz: string): Map<string, MetricEvent[]> {
  const map = new Map<string, MetricEvent[]>();
  for (const e of events) {
    const k = dateKeyInTz(e.startedAt, tz);
    const list = map.get(k) ?? [];
    list.push(e);
    map.set(k, list);
  }
  return map;
}

export function groupBy<K>(events: MetricEvent[], key: (e: MetricEvent) => K): Map<K, MetricEvent[]> {
  const map = new Map<K, MetricEvent[]>();
  for (const e of events) {
    const k = key(e);
    const list = map.get(k) ?? [];
    list.push(e);
    map.set(k, list);
  }
  return map;
}
