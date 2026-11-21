import type { PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "@/lib/db/prisma";
import { enqueueEventJobs, type EventJobData } from "@/lib/queue/queues";
import { withSystem } from "@/lib/db/context";

/**
 * PostgreSQL-based recovery. Accepted events whose processing never finished
 * (Redis was down at ingestion, a job was lost, the worker crashed) are found
 * in the inbox ledger and re-enqueued. BullMQ job ids equal raw event ids,
 * so re-enqueuing an event that is still queued is a no-op.
 */
export async function recoverUnprocessedEvents(
  opts: { staleSeconds?: number; limit?: number; client?: PrismaClient } = {},
): Promise<{ found: number; enqueued: number }> {
  const client = opts.client ?? defaultClient;
  const rows = await client.$queryRaw<{ id: string; organization_id: string }[]>`
    SELECT * FROM app_unprocessed_events(${opts.staleSeconds ?? 60}::int, ${opts.limit ?? 1000}::int)`;
  if (rows.length === 0) return { found: 0, enqueued: 0 };
  const jobs: EventJobData[] = rows.map((r) => ({ rawEventId: r.id, organizationId: r.organization_id }));
  const ok = await enqueueEventJobs(jobs);
  if (!ok) return { found: rows.length, enqueued: 0 };
  const byOrg = new Map<string, string[]>();
  for (const j of jobs) byOrg.set(j.organizationId, [...(byOrg.get(j.organizationId) ?? []), j.rawEventId]);
  for (const [orgId, ids] of byOrg) {
    await withSystem(
      orgId,
      (tx) => tx.activityEventInbox.updateMany({ where: { sourceEventId: { in: ids } }, data: { enqueuedAt: new Date() } }),
      { client },
    );
  }
  return { found: rows.length, enqueued: rows.length };
}
