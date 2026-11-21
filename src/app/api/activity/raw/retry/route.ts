import { route } from "@/lib/api/handler";
import { retryFailedEvents } from "@/services/activity/activity-service";
import { withSystem } from "@/lib/db/context";
import { enqueueEventJobs } from "@/lib/queue/queues";
import { writeAudit } from "@/services/audit/audit-writer";

/** Administrator action: reset FAILED events to PENDING and re-enqueue them. */
export const POST = route({ capability: "activity:raw" }, async (ctx) => {
  const ids = await ctx.scope(async (s) => {
    const failed = await retryFailedEvents(s);
    await writeAudit(s, { action: "events.retry_failed", entityType: "RawActivityEvent", metadata: { count: failed.length } });
    return failed;
  });
  if (ids.length === 0) return { retried: 0, queued: true };
  const orgId = ctx.user!.organizationId;
  await withSystem(orgId, async (tx) => {
    await tx.rawActivityEvent.updateMany({ where: { id: { in: ids } }, data: { processingStatus: "PENDING", lastError: null, attempts: 0 } });
    await tx.activityEventInbox.updateMany({
      where: { sourceEventId: { in: ids } },
      data: { processingStatus: "PENDING", lastError: null, attempts: 0, enqueuedAt: null },
    });
  });
  const queued = await enqueueEventJobs(ids.map((rawEventId) => ({ rawEventId, organizationId: orgId })));
  return { retried: ids.length, queued };
});
