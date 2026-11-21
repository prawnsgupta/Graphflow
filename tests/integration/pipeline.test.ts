import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ingestEvents } from "@/services/events/ingestion-service";
import { processRawEvent, recordProcessingFailure } from "@/services/events/processor";
import { recoverUnprocessedEvents } from "@/services/events/recovery";
import { prisma } from "@/lib/db/prisma";
import { createFixture, destroyFixture, focusSession, makeEvent, owner, type Fixture } from "./helpers";

let f: Fixture;
beforeAll(async () => {
  f = await createFixture("pipeline");
});
afterAll(async () => {
  await destroyFixture(f);
  await owner.$disconnect();
  await prisma.$disconnect();
});

async function processAll(rawIds: string[]) {
  const outcomes: string[] = [];
  for (const id of rawIds) outcomes.push(await processRawEvent(id, f.orgId));
  return outcomes;
}

describe("event ingestion", () => {
  it("persists raw events as JSONB with a processing ledger entry", async () => {
    const u = f.users.empA1;
    const { events } = focusSession(u, f.projects.A, 5);
    const res = await ingestEvents(u, u.userId, events, { source: "agent" });
    expect(res.accepted).toBe(events.length);
    const raw = await owner.rawActivityEvent.findFirstOrThrow({ where: { clientEventId: events[0].eventId }, include: { inbox: true } });
    expect(raw.processingStatus).toBe("PENDING");
    expect(raw.payload).toMatchObject({ type: "FOCUS_STARTED", tool: "Figma.exe", projectId: f.projects.A, simulated: true });
    expect(raw.inbox?.processingStatus).toBe("PENDING");
  });

  it("treats a re-sent event id as a duplicate", async () => {
    const u = f.users.empA1;
    const e = makeEvent(u, randomUUID(), "FOCUS_STARTED", 0, { tool: "Code.exe", projectId: f.projects.A });
    const first = await ingestEvents(u, u.userId, [e], { source: "agent" });
    const second = await ingestEvents(u, u.userId, [e], { source: "agent" });
    expect(first.results[0].status).toBe("accepted");
    expect(second.results[0].status).toBe("duplicate");
    expect(await owner.rawActivityEvent.count({ where: { clientEventId: e.eventId } })).toBe(1);
  });

  it("rejects events for unassigned projects, foreign devices and future timestamps", async () => {
    const u = f.users.empA1;
    const s = randomUUID();
    const res = await ingestEvents(
      u,
      u.userId,
      [
        makeEvent(u, s, "FOCUS_STARTED", 0, { projectId: f.projects.B }),
        makeEvent(f.users.empA2, randomUUID(), "FOCUS_STARTED", 0),
        makeEvent(u, s, "SESSION_HEARTBEAT", 0, {}, Date.now() + 3600_000),
      ],
      { source: "agent" },
    );
    expect(res.results.map((r) => r.code)).toEqual(["INVALID_PROJECT", "INVALID_DEVICE", "FUTURE_TIMESTAMP"]);
  });

  it("stores nothing without tracking consent", async () => {
    const u = f.users.empA2;
    await owner.user.update({ where: { id: u.userId }, data: { trackingConsent: false } });
    const { events } = focusSession(u, f.projects.A, 2);
    await expect(ingestEvents(u, u.userId, events, { source: "agent" })).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    expect(await owner.rawActivityEvent.count({ where: { clientEventId: events[0].eventId } })).toBe(0);
    await owner.user.update({ where: { id: u.userId }, data: { trackingConsent: true } });
  });

  it("does not let an employee submit activity for someone else", async () => {
    const { events } = focusSession(f.users.empA2, f.projects.A, 2);
    await expect(ingestEvents(f.users.empA1, f.users.empA2.userId, events, { source: "simulator" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("background processing", () => {
  it("reconstructs FocusEvents in PostgreSQL and is idempotent", async () => {
    const u = f.users.empA2;
    const { sessionId, events } = focusSession(u, f.projects.A, 30, { tool: "Figma.exe" });
    const res = await ingestEvents(u, u.userId, events, { source: "agent" });
    const ids = res.results.map((r) => r.rawEventId!);
    const outcomes = await processAll(ids);
    expect(outcomes.every((o) => o === "processed")).toBe(true);

    const focus = await owner.focusEvent.findMany({ where: { sessionId } });
    expect(focus).toHaveLength(1);
    expect(focus[0]).toMatchObject({ durationSeconds: 1800, activityCategory: "DEEP_FOCUS", isBillable: true, projectId: f.projects.A });
    const session = await owner.activitySession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.status).toBe("CLOSED");

    // Duplicate jobs: no reprocessing and no duplicate rows.
    expect(await processRawEvent(ids[0], f.orgId)).toBe("duplicate");
    expect(await owner.focusEvent.count({ where: { sessionId } })).toBe(1);
  });

  it("produces the same result regardless of delivery order", async () => {
    const u = f.users.empA1;
    const base = Date.now() - 6 * 3600_000;
    const build = (b: number, deviceId: string) => {
      const s = randomUUID();
      const d = { deviceId };
      return {
        s,
        events: [
          makeEvent(d, s, "FOCUS_STARTED", 0, { tool: "Code.exe", projectId: f.projects.A }, b),
          ...Array.from({ length: 9 }, (_, i) => makeEvent(d, s, "SESSION_HEARTBEAT", i + 1, {}, b)),
          makeEvent(d, s, "APPLICATION_SWITCH", 10, { tool: "chrome.exe" }, b),
          makeEvent(d, s, "APPLICATION_SWITCH", 14, { tool: "Code.exe" }, b),
          ...Array.from({ length: 5 }, (_, i) => makeEvent(d, s, "SESSION_HEARTBEAT", i + 15, {}, b)),
          makeEvent(d, s, "FOCUS_ENDED", 20, {}, b),
        ],
      };
    };
    const inOrder = build(base, u.deviceId);
    const r1 = await ingestEvents(u, u.userId, inOrder.events, { source: "agent" });
    await processAll(r1.results.map((r) => r.rawEventId!));

    // Same activity a day earlier, delivered in reverse order across two batches.
    const shuffled = build(base - 86_400_000, u.deviceId);
    const reversed = [...shuffled.events].reverse();
    const r2a = await ingestEvents(u, u.userId, reversed.slice(0, 8), { source: "agent" });
    await processAll(r2a.results.map((r) => r.rawEventId!));
    const r2b = await ingestEvents(u, u.userId, reversed.slice(8), { source: "agent" });
    await processAll(r2b.results.map((r) => r.rawEventId!));

    const shape = async (s: string) =>
      (await owner.focusEvent.findMany({ where: { sessionId: s }, orderBy: { startedAt: "asc" } })).map((e) => [e.durationSeconds, e.toolId, e.isContextSwitch]);
    expect(await shape(shuffled.s)).toEqual(await shape(inOrder.s));
    expect((await shape(inOrder.s)).filter((x) => x[2]).length).toBe(2);
  });

  it("never counts overlapping intervals from two devices twice", async () => {
    const u = f.users.empB1;
    const base = Date.now() - 5 * 3600_000;
    const dev2 = await owner.device.create({ data: { organizationId: f.orgId, userId: u.userId, name: "Second" } });
    const a = focusSession(u, f.projects.B, 30, { base });
    const b = focusSession({ deviceId: dev2.id }, f.projects.B, 30, { base: base + 10 * 60_000 });
    const ra = await ingestEvents(u, u.userId, a.events, { source: "agent" });
    const rb = await ingestEvents(u, u.userId, b.events, { source: "agent" });
    await processAll([...ra.results, ...rb.results].map((r) => r.rawEventId!));
    const total = await owner.focusEvent.aggregate({ where: { sessionId: { in: [a.sessionId, b.sessionId] } }, _sum: { durationSeconds: true } });
    expect(total._sum.durationSeconds).toBe(40 * 60); // union of [0,30] and [10,40]
  });

  it("skips events processed after consent was withdrawn", async () => {
    const u = f.users.empA1;
    const { events } = focusSession(u, f.projects.A, 3, { base: Date.now() - 60_000 * 5 });
    const res = await ingestEvents(u, u.userId, events, { source: "agent" });
    await owner.user.update({ where: { id: u.userId }, data: { trackingConsent: false, consentUpdatedAt: new Date(Date.now() - 60_000 * 10) } });
    const outcomes = await processAll(res.results.map((r) => r.rawEventId!));
    expect(outcomes.every((o) => o === "skipped")).toBe(true);
    await owner.user.update({ where: { id: u.userId }, data: { trackingConsent: true, consentUpdatedAt: new Date(Date.now() - 86_400_000 * 2) } });
  });
});

describe("reliability", () => {
  it("records retries, marks the final attempt FAILED and recovers unprocessed events", async () => {
    const u = f.users.empA2;
    const { events } = focusSession(u, f.projects.A, 2, { base: Date.now() - 2 * 3600_000 });
    const res = await ingestEvents(u, u.userId, events, { source: "agent" });
    const id = res.results[0].rawEventId!;
    await recordProcessingFailure(id, f.orgId, new Error("transient"), false);
    let raw = await owner.rawActivityEvent.findUniqueOrThrow({ where: { id } });
    expect(raw).toMatchObject({ processingStatus: "RETRYING", attempts: 1, lastError: "transient" });
    await recordProcessingFailure(id, f.orgId, new Error("permanent"), true);
    raw = await owner.rawActivityEvent.findUniqueOrThrow({ where: { id } });
    expect(raw).toMatchObject({ processingStatus: "FAILED", attempts: 2 });

    // Simulate a Redis outage at ingestion: never enqueued -> recovery finds it.
    const other = res.results[1].rawEventId!;
    await owner.activityEventInbox.update({ where: { sourceEventId: other }, data: { enqueuedAt: null } });
    const recovered = await recoverUnprocessedEvents({ staleSeconds: 0, client: prisma });
    expect(recovered.found).toBeGreaterThanOrEqual(1);
    await processRawEvent(other, f.orgId);
    const rows = await owner.$queryRaw<{ id: string }[]>`SELECT id FROM app_unprocessed_events(0, 5000)`;
    expect(rows.some((r) => r.id === other)).toBe(false);
  });
});
