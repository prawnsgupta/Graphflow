import { describe, expect, it } from "vitest";
import { buildSegments, subtractIntervals, type ReconEvent } from "@/services/events/reconstruction";

const MIN = 60_000;
const opts = { heartbeatTimeoutMs: 5 * MIN, idleTimeoutMs: 5 * MIN };
const P = "11111111-1111-4111-8111-111111111111";
let n = 0;
const ev = (type: ReconEvent["type"], minute: number, extra: Partial<ReconEvent> = {}): ReconEvent => ({
  id: `e${++n}`,
  type,
  ts: minute * MIN,
  seq: n,
  ...extra,
});
const heartbeats = (from: number, to: number, extra: Partial<ReconEvent> = {}) => {
  const out: ReconEvent[] = [];
  for (let m = from; m < to; m++) out.push(ev("SESSION_HEARTBEAT", m, extra));
  return out;
};

describe("buildSegments — durations", () => {
  it("builds one segment for continuous focus and sums duration correctly", () => {
    const r = buildSegments(
      [ev("FOCUS_STARTED", 0, { tool: "Figma.exe", projectId: P }), ...heartbeats(1, 30), ev("FOCUS_ENDED", 30)],
      opts,
    );
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0].end - r.segments[0].start).toBe(30 * MIN);
    expect(r.ended).toBe(true);
  });

  it("is independent of delivery order (out-of-order timestamps)", () => {
    const events = [
      ev("FOCUS_STARTED", 0, { tool: "Code.exe", projectId: P }),
      ev("APPLICATION_SWITCH", 10, { tool: "chrome.exe" }),
      ev("APPLICATION_SWITCH", 14, { tool: "Code.exe" }),
      ...heartbeats(1, 20),
      ev("FOCUS_ENDED", 20),
    ];
    const shuffled = [...events].reverse();
    expect(buildSegments(shuffled, opts).segments).toEqual(buildSegments(events, opts).segments);
  });

  it("treats repeated start and stop events idempotently", () => {
    const r = buildSegments(
      [
        ev("FOCUS_STARTED", 0, { tool: "Code.exe", projectId: P }),
        ev("FOCUS_STARTED", 1, { tool: "Code.exe", projectId: P }),
        ...heartbeats(2, 10),
        ev("FOCUS_ENDED", 10),
        ev("FOCUS_ENDED", 11),
      ],
      opts,
    );
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0].end).toBe(10 * MIN);
  });

  it("never extends an open session beyond the last evidence", () => {
    const r = buildSegments([ev("FOCUS_STARTED", 0, { tool: "Code.exe", projectId: P }), ...heartbeats(1, 7)], opts);
    expect(r.ended).toBe(false);
    expect(r.segments.at(-1)!.end).toBe(6 * MIN);
  });

  it("closes the segment at the last heartbeat when heartbeats go missing", () => {
    const r = buildSegments(
      [
        ev("FOCUS_STARTED", 0, { tool: "Code.exe", projectId: P }),
        ...heartbeats(1, 10),
        // 20-minute gap: device disconnected
        ev("SESSION_HEARTBEAT", 29),
        ev("SESSION_HEARTBEAT", 30),
        ev("FOCUS_ENDED", 33),
      ],
      opts,
    );
    expect(r.segments.map((s) => [s.start / MIN, s.end / MIN])).toEqual([
      [0, 9],
      [29, 33],
    ]);
  });

  it("implicitly starts focus when FOCUS_STARTED was lost", () => {
    const r = buildSegments([ev("APP_OPENED", 0, { tool: "Figma.exe", projectId: P }), ev("FOCUS_ENDED", 3)], opts);
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0].tool).toBe("Figma.exe");
  });
});

describe("buildSegments — idle detection", () => {
  it("splits idle intervals from active work", () => {
    const r = buildSegments(
      [
        ev("FOCUS_STARTED", 0, { tool: "Code.exe", projectId: P }),
        ...heartbeats(1, 10),
        ev("IDLE_STARTED", 10),
        ...heartbeats(11, 20),
        ev("IDLE_ENDED", 20),
        ...heartbeats(21, 30),
        ev("FOCUS_ENDED", 30),
      ],
      opts,
    );
    expect(r.segments.map((s) => [s.idle, (s.end - s.start) / MIN])).toEqual([
      [false, 10],
      [true, 10],
      [false, 10],
    ]);
  });

  it("detects idle from heartbeat idleSeconds when IDLE_STARTED is missing", () => {
    const r = buildSegments(
      [
        ev("FOCUS_STARTED", 0, { tool: "Code.exe", projectId: P }),
        // Collector keeps sending heartbeats; input stopped at minute 9.
        ...Array.from({ length: 14 }, (_, i) => ev("SESSION_HEARTBEAT", i + 1, { idleSeconds: Math.max(0, i + 1 - 9) * 60 })),
        ev("SESSION_HEARTBEAT", 15, { idleSeconds: 360 }),
        ev("SESSION_HEARTBEAT", 16, { idleSeconds: 2 }),
        ev("FOCUS_ENDED", 22),
      ],
      opts,
    );
    const idle = r.segments.filter((s) => s.idle);
    expect(idle).toHaveLength(1);
    expect(idle[0].start).toBe(9 * MIN);
  });
});

describe("buildSegments — context switching", () => {
  it("counts application and project changes as context switches", () => {
    const r = buildSegments(
      [
        ev("FOCUS_STARTED", 0, { tool: "Code.exe", projectId: P }),
        ev("APPLICATION_SWITCH", 5, { tool: "chrome.exe" }),
        ev("APPLICATION_SWITCH", 8, { tool: "Code.exe" }),
        ev("FILE_CONTEXT_CHANGED", 9, { file: { name: "a.ts", path: "/a.ts" } }),
        ev("PROJECT_CHANGED", 12, { projectId: null }),
        ev("FOCUS_ENDED", 15),
      ],
      opts,
    );
    expect(r.contextSwitches).toBe(3);
    expect(r.segments.filter((s) => s.contextSwitch).map((s) => s.start / MIN)).toEqual([5, 8, 12]);
  });
});

describe("subtractIntervals", () => {
  it("removes overlap with other sessions so time is not counted twice", () => {
    const out = subtractIntervals([{ start: 0, end: 60 * MIN }], [{ start: 10 * MIN, end: 20 * MIN }]);
    expect(out.map((s) => [s.start / MIN, s.end / MIN])).toEqual([
      [0, 10],
      [20, 60],
    ]);
  });
});
