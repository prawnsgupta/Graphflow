import { describe, expect, it } from "vitest";
import {
  applyRounding,
  billableAmount,
  budgetUtilization,
  pct,
  sumDecimalStrings,
  toCents,
} from "@/services/billing/billing-math";
import {
  computeFriction,
  deepFocusRatio,
  DEFAULT_FRICTION_SETTINGS,
  frictionRatio,
  summarize,
  switchesPerActiveHour,
  type MetricEvent,
} from "@/services/analytics/metrics";
import {
  addDaysToKey,
  dateKeyInTz,
  formatDuration,
  localRangeToUtc,
  startOfWeekKey,
  tzOffsetMs,
  zonedMidnightUtc,
} from "@/lib/utils/time";

describe("billing math", () => {
  it("rounds billable seconds by rule", () => {
    expect(applyRounding(361, "NONE")).toBe(361);
    expect(applyRounding(361, "UP_6_MIN")).toBe(720);
    expect(applyRounding(901, "UP_15_MIN")).toBe(1800);
    expect(applyRounding(1349, "NEAREST_15_MIN")).toBe(900);
    expect(applyRounding(1350, "NEAREST_15_MIN")).toBe(1800);
  });

  it("computes billable amount exactly to the cent", () => {
    expect(billableAmount(3600, "125.00")).toBe("125.00");
    expect(billableAmount(5400, "99.99")).toBe("149.99"); // 149.985 -> half-up
    expect(billableAmount(1, "100.00")).toBe("0.03"); // 0.02777 -> 0.03
    expect(billableAmount(0, "150.00")).toBe("0.00");
    expect(billableAmount(36_000_000, "0.10")).toBe("1000.00");
  });

  it("parses and sums decimals without float error", () => {
    expect(toCents("0.1") + toCents("0.2")).toBe(30n);
    expect(sumDecimalStrings(["0.10", "0.20", "1234.56"])).toBe("1234.86");
  });

  it("handles zero denominators", () => {
    expect(pct(5, 0)).toBe(0);
    expect(budgetUtilization(3600, 0)).toBeNull();
    expect(budgetUtilization(36_000, "20")).toBe(50);
  });
});

const ev = (startMin: number, durMin: number, category: MetricEvent["category"], extra: Partial<MetricEvent> = {}): MetricEvent => ({
  userId: "u1",
  projectId: "p1",
  toolId: "t1",
  startedAt: new Date(Date.UTC(2026, 0, 5, 9, startMin)),
  endedAt: new Date(Date.UTC(2026, 0, 5, 9, startMin + durMin)),
  durationSeconds: durMin * 60,
  category,
  isBillable: category === "DEEP_FOCUS" || category === "ACTIVE_WORK",
  isContextSwitch: false,
  ...extra,
});

describe("analytics metrics", () => {
  it("summarizes tracked, idle, deep focus and billable time", () => {
    const t = summarize([ev(0, 30, "DEEP_FOCUS"), ev(30, 10, "IDLE"), ev(40, 10, "ACTIVE_WORK", { isContextSwitch: true })]);
    expect(t).toMatchObject({ trackedSeconds: 3000, activeSeconds: 2400, idleSeconds: 600, deepFocusSeconds: 1800, billableSeconds: 2400, nonBillableSeconds: 600, contextSwitches: 1 });
    expect(deepFocusRatio(t)).toBe(75);
    expect(switchesPerActiveHour(t)).toBe(1.5);
  });

  it("computes friction from idle, unassigned, excess switches and fragments", () => {
    const events: MetricEvent[] = [
      ev(0, 5, "IDLE"),
      ev(5, 5, "UNASSIGNED", { projectId: null }),
      // 8 switches in one hour, threshold 6 -> 2 excess * 120s
      ...Array.from({ length: 8 }, (_, i) => ev(10 + i, 1, "ACTIVE_WORK", { isContextSwitch: true })),
    ];
    const f = computeFriction(events, DEFAULT_FRICTION_SETTINGS);
    expect(f.idleSeconds).toBe(300);
    expect(f.unassignedSeconds).toBe(300);
    expect(f.excessSwitchSeconds).toBe(240);
    expect(f.fragmentedSeconds).toBe(480); // eight 60s fragments (< 120s) in the same hour
    expect(f.totalSeconds).toBe(1080); // capped at tracked time (1080s)
    expect(frictionRatio(f.totalSeconds, summarize(events))).toBe(100);
  });

  it("does not treat collaboration or administrative time as friction", () => {
    const f = computeFriction([ev(0, 30, "COLLABORATION"), ev(30, 30, "ADMINISTRATIVE")], DEFAULT_FRICTION_SETTINGS);
    expect(f.totalSeconds).toBe(0);
  });
});

describe("timezone conversion", () => {
  it("buckets instants by local date", () => {
    const instant = new Date("2026-03-10T03:30:00Z");
    expect(dateKeyInTz(instant, "UTC")).toBe("2026-03-10");
    expect(dateKeyInTz(instant, "America/New_York")).toBe("2026-03-09");
    expect(dateKeyInTz(instant, "Asia/Kolkata")).toBe("2026-03-10");
  });

  it("finds local midnight in UTC across DST", () => {
    expect(zonedMidnightUtc("2026-01-15", "America/New_York").toISOString()).toBe("2026-01-15T05:00:00.000Z");
    expect(zonedMidnightUtc("2026-07-15", "America/New_York").toISOString()).toBe("2026-07-15T04:00:00.000Z");
    expect(zonedMidnightUtc("2026-03-08", "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(tzOffsetMs(new Date("2026-07-15T12:00:00Z"), "Asia/Kolkata")).toBe(5.5 * 3600_000);
  });

  it("builds half-open UTC ranges and week starts", () => {
    const r = localRangeToUtc("2026-01-05", "2026-01-11", "UTC");
    expect(r.end.getTime() - r.start.getTime()).toBe(7 * 86_400_000);
    expect(startOfWeekKey("2026-01-08")).toBe("2026-01-05");
    expect(addDaysToKey("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("formats durations", () => {
    expect(formatDuration(3725)).toBe("1h 02m");
    expect(formatDuration(65)).toBe("1m 05s");
  });
});
