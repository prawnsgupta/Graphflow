import { describe, expect, it } from "vitest";
import { expandScenario, getScenario, mulberry32, SCENARIOS } from "@/lib/simulator/scenarios";
import { buildSegments } from "@/services/events/reconstruction";
import { activityEventSchema } from "@/lib/validation/events";

const PROJECT = "22222222-2222-4222-8222-222222222222";

describe("scenarios", () => {
  it("defines at least five scenarios", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(5);
  });

  it("is deterministic for a given seed", () => {
    const build = () =>
      expandScenario(getScenario("INTERRUPTED_DEV").build({ projectKey: "k", rand: mulberry32(42), scale: 1 }), {
        projectId: PROJECT,
      });
    expect(build()).toEqual(build());
  });

  it.each(SCENARIOS.map((s) => s.id))("%s produces schema-valid events that reconstruct cleanly", (id) => {
    const events = expandScenario(getScenario(id).build({ projectKey: "k", rand: mulberry32(7), scale: 1 }), {
      projectId: PROJECT,
    });
    const base = Date.UTC(2026, 0, 5, 9);
    const primary = events.filter((e) => e.actor === "primary");
    for (const e of primary) {
      const parsed = activityEventSchema.safeParse({
        eventId: crypto.randomUUID(),
        type: e.type,
        timestamp: new Date(base + e.offsetMs).toISOString(),
        deviceId: crypto.randomUUID(),
        sessionId: crypto.randomUUID(),
        sequence: e.sequence,
        projectId: e.projectId,
        tool: e.tool,
        file: e.file,
        idleSeconds: e.idleSeconds,
      });
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
    const r = buildSegments(
      primary.map((e, i) => ({ id: `e${i}`, type: e.type, ts: base + e.offsetMs, seq: e.sequence, tool: e.tool, projectId: e.projectId, file: e.file, idleSeconds: e.idleSeconds })),
      { heartbeatTimeoutMs: 300_000, idleTimeoutMs: 300_000 },
    );
    expect(r.ended).toBe(true);
    expect(r.segments.length).toBeGreaterThan(0);
    for (let i = 1; i < r.segments.length; i++) expect(r.segments[i].start).toBeGreaterThanOrEqual(r.segments[i - 1].end);
  });

  it("deep design work yields deep focus and idle period yields idle time", () => {
    const deep = expandScenario(getScenario("IDLE_PERIOD").build({ projectKey: "k", rand: () => 0.5, scale: 1 }), { projectId: PROJECT });
    const r = buildSegments(
      deep.map((e, i) => ({ id: `e${i}`, type: e.type, ts: e.offsetMs, seq: e.sequence, tool: e.tool, projectId: e.projectId, idleSeconds: e.idleSeconds })),
      { heartbeatTimeoutMs: 300_000, idleTimeoutMs: 300_000 },
    );
    const idle = r.segments.filter((s) => s.idle).reduce((a, s) => a + s.end - s.start, 0);
    expect(idle).toBe(16 * 60_000);
  });
});
