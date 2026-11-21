/**
 * Event processor — runs in the background worker (and in the trusted seed).
 *
 * Processing a raw event = rebuilding the whole activity session it belongs
 * to from all accepted raw events, then replacing that session's normalized
 * FocusEvents in ONE PostgreSQL transaction. This makes processing:
 *   - idempotent (same inputs -> same rows; PROCESSED inbox rows are skipped),
 *   - order-independent (late / out-of-order events just trigger a rebuild),
 *   - safe under concurrency (per-session advisory lock).
 */
import type { PrismaClient, Prisma } from "@prisma/client";
import { withSystem, type Tx } from "@/lib/db/context";
import type { EventType, FileMetadata, StoredEventPayload } from "@/lib/validation/events";
import { buildSegments, subtractIntervals, type ReconEvent, type Segment } from "./reconstruction";
import { classifySegments, type ClassifiedSegment } from "./classification";
import { detectCollaboration, type CollabInterval } from "./collaboration";
import { getOrgSettings } from "@/repositories/settings-repository";
import { loadToolMap, lookupTool } from "@/repositories/tool-repository";
import { DEFAULT_PROJECT_RULES, loadBillingRules } from "@/repositories/billing-config-repository";

export type ProcessOutcome = "processed" | "duplicate" | "skipped" | "missing";

export interface RebuildResult {
  segments: number;
  trackedSeconds: number;
  contextSwitches: number;
  status: "OPEN" | "CLOSED" | "TIMED_OUT";
  collaborationLinks: number;
}

const lockKey = (prefix: string, id: string) => `${prefix}:${id}`;

async function advisoryLock(tx: Tx, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

function toReconEvent(row: { id: string; eventType: EventType; eventTimestamp: Date; sequence: number; payload: Prisma.JsonValue }): ReconEvent {
  const p = (row.payload ?? {}) as unknown as Partial<StoredEventPayload>;
  return {
    id: row.id,
    type: row.eventType,
    ts: row.eventTimestamp.getTime(),
    seq: row.sequence,
    tool: p.tool,
    projectId: p.projectId === undefined ? undefined : p.projectId,
    file: p.file === undefined ? undefined : (p.file as FileMetadata | null),
    idleSeconds: p.idleSeconds,
  };
}

/** Rebuild one session's normalized records. Caller must hold a SYSTEM-context transaction. */
export async function rebuildSession(tx: Tx, sessionId: string, now = new Date()): Promise<RebuildResult | null> {
  await advisoryLock(tx, lockKey("session", sessionId));
  const session = await tx.activitySession.findUnique({ where: { id: sessionId } });
  if (!session) return null;
  const orgId = session.organizationId;

  const [settings, user, rawRows, tools] = await Promise.all([
    getOrgSettings(tx, orgId),
    tx.user.findUnique({ where: { id: session.userId }, select: { trackingConsent: true, consentUpdatedAt: true } }),
    tx.rawActivityEvent.findMany({
      where: { sessionId, processingStatus: { notIn: ["SKIPPED", "FAILED"] } },
      select: { id: true, eventType: true, eventTimestamp: true, sequence: true, payload: true, receivedAt: true },
    }),
    loadToolMap(tx, orgId),
  ]);

  // Consent withdrawal: events after the withdrawal moment are never counted.
  const consentCutoff = user && !user.trackingConsent && user.consentUpdatedAt ? user.consentUpdatedAt.getTime() : null;
  const events = rawRows.map(toReconEvent).filter((e) => consentCutoff === null || e.ts <= consentCutoff);

  const heartbeatTimeoutMs = settings.heartbeatTimeoutMinutes * 60_000;
  const recon = buildSegments(events, { heartbeatTimeoutMs, idleTimeoutMs: settings.idleTimeoutMinutes * 60_000 });

  // Never count the same wall-clock time twice across a user's sessions/devices.
  let segments: Segment[] = recon.segments;
  if (segments.length > 0) {
    const busy = await tx.focusEvent.findMany({
      where: {
        userId: session.userId,
        sessionId: { not: sessionId },
        startedAt: { lt: new Date(segments[segments.length - 1].end) },
        endedAt: { gt: new Date(segments[0].start) },
      },
      select: { startedAt: true, endedAt: true },
    });
    const before = segments;
    segments = subtractIntervals(
      before,
      busy.map((b) => ({ start: b.startedAt.getTime(), end: b.endedAt.getTime() })),
    );
    // Only the first piece of a split segment keeps its context-switch flag.
    const seen = new Set<string>();
    segments = segments.map((s) => {
      const key = `${s.sourceEventId}|${s.contextSwitch}`;
      if (s.contextSwitch && seen.has(key)) return { ...s, contextSwitch: false };
      seen.add(key);
      return s;
    });
  }

  const projectIds = [...new Set(segments.map((s) => s.projectId).filter((p): p is string => !!p))];
  // Ignore references to projects that no longer exist in this organization.
  const validProjects = new Set(
    (await tx.project.findMany({ where: { id: { in: projectIds }, organizationId: orgId }, select: { id: true } })).map((p) => p.id),
  );
  segments = segments.map((s) => (s.projectId && !validProjects.has(s.projectId) ? { ...s, projectId: null } : s));
  const rules = await loadBillingRules(tx, [...validProjects]);

  const classified: ClassifiedSegment[] = classifySegments(segments, {
    tools,
    rules: (pid) => rules.get(pid) ?? DEFAULT_PROJECT_RULES,
    focus: {
      deepFocusMinMs: settings.deepFocusMinMinutes * 60_000,
      deepFocusMaxGapMs: settings.deepFocusMaxGapMinutes * 60_000,
    },
  });

  // File metadata (never contents) -> File rows.
  const fileIds = new Map<string, string>();
  for (const seg of classified) {
    if (!seg.file || fileIds.has(seg.file.path)) continue;
    const tool = lookupTool(tools, seg.tool);
    const f = await tx.file.upsert({
      where: { organizationId_filePath: { organizationId: orgId, filePath: seg.file.path } },
      create: {
        organizationId: orgId,
        projectId: seg.projectId,
        toolId: tool?.id ?? null,
        fileName: seg.file.name,
        filePath: seg.file.path,
        fileType: seg.file.type ?? null,
        createdById: session.userId,
      },
      update: {},
      select: { id: true },
    });
    fileIds.set(seg.file.path, f.id);
  }

  await tx.focusEvent.deleteMany({ where: { sessionId } });
  if (classified.length > 0) {
    await tx.focusEvent.createMany({
      data: classified.map((s) => {
        const duration = Math.round((s.end - s.start) / 1000);
        return {
          organizationId: orgId,
          userId: session.userId,
          projectId: s.projectId,
          toolId: s.toolId,
          fileId: s.file ? (fileIds.get(s.file.path) ?? null) : null,
          deviceId: session.deviceId,
          sessionId,
          sourceEventId: s.sourceEventId,
          startedAt: new Date(s.start),
          endedAt: new Date(s.end),
          durationSeconds: Math.max(1, duration),
          idleDurationSeconds: s.category === "IDLE" ? Math.max(1, duration) : 0,
          isIdle: s.category === "IDLE",
          isBillable: s.isBillable,
          isContextSwitch: s.contextSwitch,
          isSimulated: session.isSimulated,
          activityCategory: s.category,
        };
      }),
    });
  }

  // Session aggregates and lifecycle.
  const sum = (pred: (s: ClassifiedSegment) => boolean) =>
    classified.filter(pred).reduce((acc, s) => acc + Math.round((s.end - s.start) / 1000), 0);
  const tracked = sum(() => true);
  const idle = sum((s) => s.category === "IDLE");
  const perProject = new Map<string, number>();
  for (const s of classified) if (s.projectId) perProject.set(s.projectId, (perProject.get(s.projectId) ?? 0) + (s.end - s.start));
  const mainProject = [...perProject.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const lastEvidence = recon.lastEvidenceAt ?? session.lastEventAt.getTime();
  // Liveness uses the most recent of event time and receipt time: accelerated
  // simulations are back-dated, so a session can be live with older timestamps.
  const lastReceived = rawRows.reduce((m, r) => Math.max(m, r.receivedAt.getTime()), 0);
  const status: RebuildResult["status"] = recon.ended
    ? "CLOSED"
    : now.getTime() - Math.max(lastEvidence, lastReceived) > heartbeatTimeoutMs
      ? "TIMED_OUT"
      : "OPEN";

  await tx.activitySession.update({
    where: { id: sessionId },
    data: {
      startedAt: new Date(recon.firstEventAt ?? session.startedAt.getTime()),
      lastEventAt: new Date(Math.max(lastEvidence, recon.firstEventAt ?? 0)),
      endedAt: status === "OPEN" ? null : new Date(lastEvidence),
      status,
      projectId: mainProject,
      trackedSeconds: tracked,
      idleSeconds: idle,
      activeSeconds: tracked - idle,
      deepFocusSeconds: sum((s) => s.category === "DEEP_FOCUS"),
      contextSwitchCount: classified.filter((s) => s.contextSwitch).length,
    },
  });

  const links = await rebuildCollaboration(tx, session.userId, sessionId, orgId, classified, tools);

  return {
    segments: classified.length,
    trackedSeconds: tracked,
    contextSwitches: classified.filter((s) => s.contextSwitch).length,
    status,
    collaborationLinks: links,
  };
}

async function rebuildCollaboration(
  tx: Tx,
  userId: string,
  sessionId: string,
  orgId: string,
  classified: ClassifiedSegment[],
  tools: Map<string, { id: string; name: string }>,
): Promise<number> {
  const mineCollab = classified.filter((s) => s.category === "COLLABORATION" && s.projectId);
  const projects = [...new Set(mineCollab.map((s) => s.projectId!))].sort();
  for (const p of projects) await advisoryLock(tx, lockKey("collab", p));

  await tx.collaborationLink.deleteMany({ where: { OR: [{ sourceSessionId: sessionId }, { targetSessionId: sessionId }] } });
  if (mineCollab.length === 0) return 0;

  const toolName = (toolId: string | null) => {
    if (!toolId) return null;
    for (const t of tools.values()) if (t.id === toolId) return t.name;
    return null;
  };
  const start = Math.min(...mineCollab.map((s) => s.start));
  const end = Math.max(...mineCollab.map((s) => s.end));
  const others = await tx.focusEvent.findMany({
    where: {
      organizationId: orgId,
      activityCategory: "COLLABORATION",
      projectId: { in: projects },
      userId: { not: userId },
      startedAt: { lt: new Date(end) },
      endedAt: { gt: new Date(start) },
    },
    select: { userId: true, sessionId: true, projectId: true, startedAt: true, endedAt: true, toolId: true },
  });
  // Both users must be assigned to the project (authorized project metadata only).
  const members = await tx.projectMember.findMany({
    where: { projectId: { in: projects } },
    select: { projectId: true, userId: true },
  });
  const isMember = (pid: string, uid: string) => members.some((m) => m.projectId === pid && m.userId === uid);

  const mine: CollabInterval[] = mineCollab
    .filter((s) => isMember(s.projectId!, userId))
    .map((s) => ({ userId, sessionId, projectId: s.projectId!, start: s.start, end: s.end, toolName: toolName(s.toolId) }));
  const theirs: CollabInterval[] = others
    .filter((o) => o.projectId && isMember(o.projectId, o.userId))
    .map((o) => ({
      userId: o.userId,
      sessionId: o.sessionId,
      projectId: o.projectId!,
      start: o.startedAt.getTime(),
      end: o.endedAt.getTime(),
      toolName: toolName(o.toolId),
    }));
  const switchTimes = classified.filter((s) => s.contextSwitch).map((s) => s.start);
  const drafts = detectCollaboration(mine, theirs, switchTimes);
  if (drafts.length === 0) return 0;
  await tx.collaborationLink.createMany({
    data: drafts.map((d) => ({
      organizationId: orgId,
      sourceUserId: d.sourceUserId,
      targetUserId: d.targetUserId,
      projectId: d.projectId,
      sourceSessionId: d.sourceSessionId,
      targetSessionId: d.targetSessionId,
      interactionType: d.interactionType,
      startedAt: new Date(d.start),
      endedAt: new Date(d.end),
      durationSeconds: d.durationSeconds,
      contextSwitchCount: d.contextSwitchCount,
    })),
  });
  return drafts.length;
}

/**
 * Process one accepted raw event (worker entry point). Idempotent: a
 * PROCESSED/SKIPPED inbox row is never processed twice, and the inbox row
 * lock serialises duplicate jobs for the same event.
 */
export async function processRawEvent(
  rawEventId: string,
  organizationId: string,
  opts: { client?: PrismaClient } = {},
): Promise<ProcessOutcome> {
  return withSystem(
    organizationId,
    async (tx) => {
      const inbox = await tx.$queryRaw<{ processing_status: string }[]>`
        SELECT processing_status FROM activity_event_inbox
        WHERE source_event_id = ${rawEventId}::uuid FOR UPDATE`;
      if (inbox.length === 0) return "missing";
      if (inbox[0].processing_status === "PROCESSED" || inbox[0].processing_status === "SKIPPED") return "duplicate";

      const raw = await tx.rawActivityEvent.findUnique({
        where: { id: rawEventId },
        select: { id: true, sessionId: true, userId: true, eventTimestamp: true },
      });
      if (!raw) return "missing";

      const user = await tx.user.findUnique({
        where: { id: raw.userId },
        select: { trackingConsent: true, consentUpdatedAt: true },
      });
      const now = new Date();
      const consentWithdrawn =
        !!user && !user.trackingConsent && (!user.consentUpdatedAt || user.consentUpdatedAt <= raw.eventTimestamp);
      if (consentWithdrawn) {
        const reason = "Tracking consent withdrawn before this event; not processed";
        await tx.rawActivityEvent.update({
          where: { id: rawEventId },
          data: { processingStatus: "SKIPPED", processedAt: now, lastError: reason, attempts: { increment: 1 } },
        });
        await tx.activityEventInbox.update({
          where: { sourceEventId: rawEventId },
          data: { processingStatus: "SKIPPED", processedAt: now, lastError: reason, attempts: { increment: 1 } },
        });
        return "skipped";
      }

      await rebuildSession(tx, raw.sessionId, now);

      await tx.rawActivityEvent.update({
        where: { id: rawEventId },
        data: { processingStatus: "PROCESSED", processedAt: now, lastError: null, attempts: { increment: 1 } },
      });
      await tx.activityEventInbox.update({
        where: { sourceEventId: rawEventId },
        data: { processingStatus: "PROCESSED", processedAt: now, lastError: null, attempts: { increment: 1 } },
      });
      return "processed";
    },
    { client: opts.client, timeoutMs: 60_000 },
  );
}

/** Record a failed attempt (separate transaction: the processing one rolled back). */
export async function recordProcessingFailure(
  rawEventId: string,
  organizationId: string,
  error: unknown,
  final: boolean,
  opts: { client?: PrismaClient } = {},
): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
  const status = final ? "FAILED" : "RETRYING";
  await withSystem(
    organizationId,
    async (tx) => {
      await tx.rawActivityEvent.updateMany({
        where: { id: rawEventId, processingStatus: { notIn: ["PROCESSED", "SKIPPED"] } },
        data: { processingStatus: status, lastError: message, attempts: { increment: 1 } },
      });
      await tx.activityEventInbox.updateMany({
        where: { sourceEventId: rawEventId, processingStatus: { notIn: ["PROCESSED", "SKIPPED"] } },
        data: { processingStatus: status, lastError: message, attempts: { increment: 1 } },
      });
    },
    { client: opts.client },
  );
}

/** Close sessions whose heartbeat timed out (no new events). */
export async function sweepStaleSession(sessionId: string, organizationId: string, opts: { client?: PrismaClient } = {}) {
  return withSystem(organizationId, (tx) => rebuildSession(tx, sessionId), { client: opts.client, timeoutMs: 60_000 });
}
