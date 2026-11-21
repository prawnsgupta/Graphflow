/**
 * Simulator runs. The simulator is an authorized, clearly-labelled SIMULATED
 * collector: its events go through the same ingestion API, validation,
 * storage, queue and worker as a real agent would use.
 */
import type { DbScope } from "@/lib/db/context";
import { writeAudit } from "@/services/audit/audit-writer";
import { AppError, forbidden, notFound, unprocessable } from "@/lib/api/errors";
import { can } from "@/lib/permissions";
import { getOrgSettings } from "@/repositories/settings-repository";

async function canSimulateFor(scope: DbScope, userId: string): Promise<boolean> {
  if (userId === scope.actor.userId) return true;
  if (!can(scope.actor.role, "simulator:others")) return false;
  const [{ allowed }] = await scope.tx.$queryRaw<{ allowed: boolean }[]>`SELECT app_can_manage_user(${userId}::uuid) AS allowed`;
  return allowed;
}

/** Employees, devices and projects the current user may simulate with. */
export async function simulatorOptions(scope: DbScope) {
  const { tx, actor } = scope;
  const candidates = can(actor.role, "simulator:others")
    ? await tx.user.findMany({ where: { isActive: true }, select: { id: true }, orderBy: { displayName: "asc" } })
    : [{ id: actor.userId }];
  const allowedIds: string[] = [];
  for (const c of candidates) if (await canSimulateFor(scope, c.id)) allowedIds.push(c.id);

  const users = await tx.user.findMany({
    where: { id: { in: allowedIds } },
    orderBy: { displayName: "asc" },
    select: {
      id: true,
      displayName: true,
      role: true,
      trackingConsent: true,
      devices: { where: { isActive: true }, select: { id: true, name: true, isSimulated: true }, orderBy: { createdAt: "asc" } },
      projectMemberships: {
        where: { project: { status: { in: ["PLANNING", "ACTIVE"] } } },
        select: { project: { select: { id: true, name: true } } },
      },
    },
  });
  const settings = await getOrgSettings(tx, actor.organizationId);
  return {
    users: users.map((u) => ({
      id: u.id,
      displayName: u.displayName,
      role: u.role,
      trackingConsent: u.trackingConsent,
      devices: u.devices,
      projects: u.projectMemberships.map((m) => m.project),
    })),
    settings: { idleTimeoutMinutes: settings.idleTimeoutMinutes, heartbeatTimeoutMinutes: settings.heartbeatTimeoutMinutes },
  };
}

export async function startRun(
  scope: DbScope,
  input: { userId: string; deviceId: string; projectId: string | null; scenario: string; speed: number; partnerUserId?: string; partnerDeviceId?: string; durationMs?: number },
) {
  const { tx, actor } = scope;
  for (const uid of [input.userId, input.partnerUserId].filter((x): x is string => !!x)) {
    if (!(await canSimulateFor(scope, uid))) throw forbidden("You are not allowed to simulate activity for this employee");
    const u = await tx.user.findFirst({ where: { id: uid }, select: { trackingConsent: true, isActive: true, displayName: true } });
    if (!u || !u.isActive) throw notFound("Employee not found");
    if (!u.trackingConsent) throw new AppError(403, "CONSENT_REQUIRED", `${u.displayName} has not granted activity-tracking consent`);
  }
  const device = await tx.device.findFirst({ where: { id: input.deviceId, userId: input.userId, isActive: true }, select: { id: true } });
  if (!device) throw unprocessable("Device does not belong to the selected employee");
  if (input.scenario === "COLLABORATION") {
    if (!input.partnerUserId || !input.partnerDeviceId) throw unprocessable("The collaboration scenario needs a partner employee and device");
    if (input.partnerUserId === input.userId) throw unprocessable("Choose a different partner");
    if (!input.projectId) throw unprocessable("The collaboration scenario needs a shared project");
    const both = await tx.projectMember.count({ where: { projectId: input.projectId, userId: { in: [input.userId, input.partnerUserId] } } });
    if (both !== 2) throw unprocessable("Both employees must be assigned to the selected project");
  }
  const run = await tx.simulationRun.create({
    data: {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      userId: input.userId,
      deviceId: input.deviceId,
      projectId: input.projectId,
      scenario: input.scenario,
      speed: input.speed,
    },
    select: { id: true, startedAt: true },
  });
  const timelineEnd = await latestFreeWindowEnd(scope, [input.userId, input.partnerUserId].filter((x): x is string => !!x), input.durationMs ?? 0);
  await writeAudit(scope, {
    action: "simulation.started",
    entityType: "SimulationRun",
    entityId: run.id,
    projectId: input.projectId,
    metadata: { ...input, simulated: true },
  });
  return { ...run, timelineEnd };
}

/**
 * Accelerated simulations are back-dated. To avoid placing a new run on top of
 * the employee's recent activity (which the no-double-counting rule would then
 * clip away), find the latest window of the requested length that ends at or
 * before now and does not overlap their recent sessions.
 */
export async function latestFreeWindowEnd(scope: DbScope, userIds: string[], durationMs: number, now = new Date()): Promise<string> {
  const sessions = await scope.tx.activitySession.findMany({
    where: { userId: { in: userIds }, lastEventAt: { gte: new Date(now.getTime() - 6 * 24 * 3600_000) } },
    select: { startedAt: true, lastEventAt: true },
    orderBy: { startedAt: "desc" },
    take: 1000,
  });
  let end = now.getTime();
  for (let i = 0; i < 1000; i++) {
    const start = end - durationMs;
    const overlapping = sessions.filter((s) => s.startedAt.getTime() < end && s.lastEventAt.getTime() > start);
    if (overlapping.length === 0) break;
    end = Math.min(...overlapping.map((s) => s.startedAt.getTime())) - 60_000;
  }
  return new Date(end).toISOString();
}

export async function getRun(scope: DbScope, runId: string) {
  const run = await scope.tx.simulationRun.findFirst({ where: { id: runId } });
  if (!run) throw notFound("Simulation run not found");
  return run;
}

export async function updateRunStatus(scope: DbScope, runId: string, status: "RUNNING" | "PAUSED" | "STOPPED" | "COMPLETED") {
  const run = await getRun(scope, runId);
  if (run.actorId !== scope.actor.userId) throw forbidden();
  const updated = await scope.tx.simulationRun.update({
    where: { id: runId },
    data: { status, ...(status === "STOPPED" || status === "COMPLETED" ? { endedAt: new Date() } : {}) },
  });
  if (status === "STOPPED" || status === "COMPLETED")
    await writeAudit(scope, { action: `simulation.${status.toLowerCase()}`, entityType: "SimulationRun", entityId: runId, projectId: run.projectId });
  return updated;
}

/** Processing status reported by the backend for a run (pending/processed/failed). */
export async function runStats(scope: DbScope, runId: string) {
  const run = await getRun(scope, runId);
  const counts = await scope.tx.$queryRaw<{ processing_status: string; event_count: bigint }[]>`
    SELECT * FROM app_simulation_run_stats(${runId}::uuid)`;
  const recent = await scope.tx.$queryRaw<
    { client_event_id: string; event_type: string; event_timestamp: Date; processing_status: string; last_error: string | null }[]
  >`SELECT * FROM app_simulation_run_events(${runId}::uuid, 60)`;
  const get = (s: string) => Number(counts.find((c) => c.processing_status === s)?.event_count ?? 0);
  const session = await scope.tx.activitySession.findFirst({
    where: { userId: run.userId, deviceId: run.deviceId, startedAt: { gte: new Date(run.startedAt.getTime() - 24 * 3600_000) } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, status: true, trackedSeconds: true, activeSeconds: true, idleSeconds: true, deepFocusSeconds: true, contextSwitchCount: true },
  });
  return {
    run,
    counts: {
      total: counts.reduce((s, c) => s + Number(c.event_count), 0),
      processed: get("PROCESSED"),
      pending: get("PENDING") + get("PROCESSING") + get("RETRYING"),
      failed: get("FAILED"),
      skipped: get("SKIPPED"),
    },
    recent: recent.map((r) => ({ eventId: r.client_event_id, type: r.event_type, timestamp: r.event_timestamp, status: r.processing_status, error: r.last_error })),
    session,
  };
}
