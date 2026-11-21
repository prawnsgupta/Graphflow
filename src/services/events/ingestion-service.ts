/**
 * Event ingestion — the single entry point for activity data, used by the
 * agent API (/api/events), the simulator API (/api/simulator/events) and the
 * trusted seed. Steps:
 *   1. authenticated actor (route layer)  2. organization membership (RLS)
 *   3. tracking consent  4. schema validation (route layer, Zod)
 *   5. user + device authorization  6. project assignment
 *   7. unique event id  8. raw JSONB persisted  9. processing ledger row
 *   10. COMMIT  11. enqueue BullMQ job  12. respond
 * The event is durable in PostgreSQL before it is acknowledged; enqueue
 * failures are repaired by the recovery scanner.
 */
import { randomUUID } from "node:crypto";
import { withRls, withSystem, type Actor } from "@/lib/db/context";
import { enqueueEventJobs } from "@/lib/queue/queues";
import {
  MAX_EVENT_AGE_MS,
  MAX_FUTURE_SKEW_MS,
  type ActivityEventInput,
  type StoredEventPayload,
} from "@/lib/validation/events";
import { AppError, forbidden, notFound } from "@/lib/api/errors";

export type IngestStatus = "accepted" | "duplicate" | "rejected";

export interface IngestResult {
  eventId: string;
  status: IngestStatus;
  rawEventId?: string;
  code?: string;
  message?: string;
}

export interface IngestOptions {
  source: "simulator" | "agent";
  simulationRunId?: string;
  /** Set when authenticated by a device token: events must come from that device. */
  tokenDeviceId?: string;
  requestId?: string;
  now?: Date;
}

export interface IngestResponse {
  results: IngestResult[];
  accepted: number;
  duplicates: number;
  rejected: number;
  queued: boolean;
}

const ACCEPTING_PROJECT_STATUSES = new Set(["PLANNING", "ACTIVE"]);

export async function ingestEvents(
  actor: Actor,
  targetUserId: string,
  events: ActivityEventInput[],
  opts: IngestOptions,
): Promise<IngestResponse> {
  const now = opts.now ?? new Date();

  const { results, jobs } = await withRls(actor, async (tx) => {
    // 2. Organization membership — RLS hides users of other organizations.
    const target = await tx.user.findFirst({
      where: { id: targetUserId },
      select: { id: true, isActive: true, trackingConsent: true },
    });
    if (!target) throw notFound("Employee not found");

    // Acting for someone else is only possible through the simulator and
    // only for people the actor manages (application check + RLS policy).
    if (target.id !== actor.userId) {
      if (opts.source !== "simulator") throw forbidden("Collectors may only submit their own activity");
      const [{ allowed }] = await tx.$queryRaw<{ allowed: boolean }[]>`
        SELECT app_can_manage_user(${target.id}::uuid) AS allowed`;
      if (!allowed) throw forbidden("You are not allowed to simulate activity for this employee");
    }
    if (!target.isActive) throw forbidden("Employee account is deactivated");
    // 3. Consent — no consent, no collection. Nothing is stored.
    if (!target.trackingConsent)
      throw new AppError(403, "CONSENT_REQUIRED", "The employee has not granted activity-tracking consent");

    // 5. Devices must belong to the target user and be active.
    const deviceIds = [...new Set(events.map((e) => e.deviceId))];
    const devices = await tx.device.findMany({
      where: { id: { in: deviceIds }, userId: target.id, isActive: true },
      select: { id: true, isSimulated: true },
    });
    const deviceOk = new Map(devices.map((d) => [d.id, d]));

    // 6. Projects must be assigned to the target user and accepting time.
    const projectIds = [...new Set(events.map((e) => e.projectId).filter((p): p is string => !!p))];
    const memberships = projectIds.length
      ? await tx.projectMember.findMany({
          where: { userId: target.id, projectId: { in: projectIds } },
          select: { projectId: true, project: { select: { status: true } } },
        })
      : [];
    const projectOk = new Set(
      memberships.filter((m) => ACCEPTING_PROJECT_STATUSES.has(m.project.status)).map((m) => m.projectId),
    );

    // Sessions must not belong to another user/device.
    const sessionPairs = [...new Map(events.map((e) => [e.sessionId, e.deviceId])).entries()];
    const sessionOk = new Map<string, boolean>();
    for (const [sessionId, deviceId] of sessionPairs) {
      const [{ ok }] = await tx.$queryRaw<{ ok: boolean }[]>`
        SELECT app_session_owner_matches(${sessionId}::uuid, ${target.id}::uuid, ${deviceId}::uuid) AS ok`;
      sessionOk.set(sessionId, ok);
    }

    const results: IngestResult[] = [];
    const accepted: { e: ActivityEventInput; ts: Date }[] = [];
    const seenInBatch = new Set<string>();

    for (const e of events) {
      const reject = (code: string, message: string) => results.push({ eventId: e.eventId, status: "rejected", code, message });
      const ts = new Date(e.timestamp);
      if (seenInBatch.has(e.eventId)) {
        results.push({ eventId: e.eventId, status: "duplicate" });
        continue;
      }
      seenInBatch.add(e.eventId);
      if (!deviceOk.has(e.deviceId)) {
        reject("INVALID_DEVICE", "Device is not registered to this employee or is inactive");
        continue;
      }
      if (opts.tokenDeviceId && e.deviceId !== opts.tokenDeviceId) {
        reject("DEVICE_MISMATCH", "Events must come from the authenticated device");
        continue;
      }
      if (opts.source === "agent" && deviceOk.get(e.deviceId)!.isSimulated !== e.simulated) {
        reject("SIMULATION_FLAG_MISMATCH", "Simulated devices must mark events as simulated");
        continue;
      }
      if (e.projectId && !projectOk.has(e.projectId)) {
        reject("INVALID_PROJECT", "Project is not assigned to this employee or is not accepting time");
        continue;
      }
      if (!sessionOk.get(e.sessionId)) {
        reject("INVALID_SESSION", "Session belongs to a different employee or device");
        continue;
      }
      if (ts.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) {
        reject("FUTURE_TIMESTAMP", "Event timestamp is in the future");
        continue;
      }
      if (ts.getTime() < now.getTime() - MAX_EVENT_AGE_MS) {
        reject("STALE_TIMESTAMP", "Event is older than the accepted ingestion window");
        continue;
      }
      accepted.push({ e, ts });
    }

    // Create sessions on first sight (worker maintains their aggregates).
    const sessionsToCreate = new Map<string, { deviceId: string; projectId: string | null; ts: Date; simulated: boolean }>();
    for (const { e, ts } of accepted) {
      const cur = sessionsToCreate.get(e.sessionId);
      if (!cur || ts < cur.ts) sessionsToCreate.set(e.sessionId, { deviceId: e.deviceId, projectId: e.projectId ?? null, ts, simulated: e.simulated });
    }
    for (const [sessionId, s] of sessionsToCreate) {
      await tx.$executeRaw`
        INSERT INTO activity_sessions (id, organization_id, user_id, device_id, project_id, is_simulated, status, started_at, last_event_at, updated_at)
        VALUES (${sessionId}::uuid, ${actor.organizationId}::uuid, ${target.id}::uuid, ${s.deviceId}::uuid,
                ${s.projectId}::uuid, ${s.simulated}, 'OPEN', ${s.ts}, ${s.ts}, now())
        ON CONFLICT (id) DO NOTHING`;
    }

    const jobs: { rawEventId: string; organizationId: string }[] = [];
    const resultIndex = new Map<string, IngestResult>();
    for (const { e, ts } of accepted) {
      const rawId = randomUUID();
      const payload: StoredEventPayload = {
        type: e.type,
        timestamp: ts.toISOString(),
        sequence: e.sequence,
        projectId: e.projectId,
        tool: e.tool,
        previousTool: e.previousTool,
        file: e.file,
        idleSeconds: e.idleSeconds,
        simulated: e.simulated,
        source: opts.source,
      };
      // 7 + 8. Unique (organization_id, client_event_id): duplicates are a no-op.
      const inserted = await tx.$executeRaw`
        INSERT INTO raw_activity_events
          (id, organization_id, client_event_id, user_id, device_id, session_id, simulation_run_id, event_type,
           event_timestamp, sequence, payload, is_simulated, processing_status, received_at)
        VALUES (${rawId}::uuid, ${actor.organizationId}::uuid, ${e.eventId}::uuid, ${target.id}::uuid,
                ${e.deviceId}::uuid, ${e.sessionId}::uuid, ${opts.simulationRunId ?? null}::uuid,
                ${e.type}::"ActivityEventType", ${ts}, ${e.sequence}, ${JSON.stringify(payload)}::jsonb,
                ${e.simulated}, 'PENDING', now())
        ON CONFLICT (organization_id, client_event_id) DO NOTHING`;
      if (inserted === 0) {
        const r: IngestResult = { eventId: e.eventId, status: "duplicate" };
        results.push(r);
        continue;
      }
      // 9. Processing ledger, same transaction as the raw event.
      await tx.$executeRaw`
        INSERT INTO activity_event_inbox (id, organization_id, source_event_id, processing_status, received_at)
        VALUES (${randomUUID()}::uuid, ${actor.organizationId}::uuid, ${rawId}::uuid, 'PENDING', now())`;
      const r: IngestResult = { eventId: e.eventId, status: "accepted", rawEventId: rawId };
      results.push(r);
      resultIndex.set(e.eventId, r);
      jobs.push({ rawEventId: rawId, organizationId: actor.organizationId });
    }

    if (accepted.length > 0) {
      await tx.device.updateMany({ where: { id: { in: [...deviceOk.keys()] } }, data: { lastSeenAt: now } });
    }
    return { results, jobs };
  });

  // 10. Committed. 11. Enqueue (best effort; recovery scanner covers failures).
  const queued = await enqueueEventJobs(jobs);
  if (queued && jobs.length > 0) {
    await withSystem(actor.organizationId, (tx) =>
      tx.activityEventInbox.updateMany({
        where: { sourceEventId: { in: jobs.map((j) => j.rawEventId) } },
        data: { enqueuedAt: new Date() },
      }),
    ).catch(() => undefined);
  }

  return {
    results,
    accepted: results.filter((r) => r.status === "accepted").length,
    duplicates: results.filter((r) => r.status === "duplicate").length,
    rejected: results.filter((r) => r.status === "rejected").length,
    queued: jobs.length === 0 ? true : queued,
  };
}
