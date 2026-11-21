import { Queue, Worker } from "bullmq";
import { createRedisConnection } from "@/lib/redis/connection";
import { MAINTENANCE_QUEUE, QUEUE_PREFIX } from "@/lib/queue/queues";
import { prisma } from "@/lib/db/prisma";
import { sweepStaleSession } from "@/services/events/processor";
import { recoverUnprocessedEvents } from "@/services/events/recovery";
import { runScheduledBillableAudits } from "@/services/billing/billable-audit-service";

type MaintenanceJob = "sweep-stale-sessions" | "recover-events" | "billable-audits" | "retention";

/**
 * Scheduled maintenance (BullMQ repeatable jobs):
 *  - sweep-stale-sessions: close sessions whose heartbeat timed out
 *  - recover-events: re-enqueue accepted-but-unprocessed events
 *  - billable-audits: daily per-project BillableAudit snapshots
 *  - retention: apply raw-event and audit-log retention
 */
export async function startAggregationWorker(recoveryIntervalSeconds: number) {
  const connection = createRedisConnection({ maxRetriesPerRequest: null });
  const queue = new Queue(MAINTENANCE_QUEUE, { connection, prefix: QUEUE_PREFIX });
  queue.on("error", () => undefined);

  const schedule: [MaintenanceJob, number][] = [
    ["sweep-stale-sessions", 60_000],
    ["recover-events", recoveryIntervalSeconds * 1000],
    ["billable-audits", 6 * 3600_000],
    ["retention", 24 * 3600_000],
  ];
  for (const [name, every] of schedule) {
    await queue.upsertJobScheduler(name, { every }, { name, opts: { removeOnComplete: 50, removeOnFail: 100 } });
  }

  const worker = new Worker(
    MAINTENANCE_QUEUE,
    async (job) => {
      switch (job.name as MaintenanceJob) {
        case "sweep-stale-sessions":
          return sweepStaleSessions();
        case "recover-events":
          return recoverUnprocessedEvents();
        case "billable-audits":
          return runScheduledBillableAudits();
        case "retention": {
          const [r] = await prisma.$queryRaw<{ raw_events_deleted: bigint; audit_logs_deleted: bigint }[]>`
            SELECT * FROM app_apply_retention()`;
          return { rawEventsDeleted: Number(r.raw_events_deleted), auditLogsDeleted: Number(r.audit_logs_deleted) };
        }
      }
    },
    { connection, concurrency: 1, prefix: QUEUE_PREFIX },
  );
  worker.on("error", (err) => console.warn(`[maintenance] ${err.message}`));
  worker.on("failed", (job, err) => console.warn(`[maintenance] ${job?.name} failed: ${err.message}`));
  return { worker, queue };
}

export async function sweepStaleSessions(): Promise<{ closed: number }> {
  const rows = await prisma.$queryRaw<{ id: string; organization_id: string }[]>`
    SELECT * FROM app_stale_open_sessions(500)`;
  let closed = 0;
  for (const r of rows) {
    const res = await sweepStaleSession(r.id, r.organization_id).catch((e) => {
      console.warn(`[maintenance] sweep ${r.id} failed: ${(e as Error).message}`);
      return null;
    });
    if (res && res.status !== "OPEN") closed++;
  }
  return { closed };
}
