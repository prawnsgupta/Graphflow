import type { ActivityCategory, Prisma } from "@prisma/client";
import type { DbScope } from "@/lib/db/context";
import { forbidden } from "@/lib/api/errors";
import { can } from "@/lib/permissions";

export interface ActivityQuery {
  start?: Date;
  end?: Date;
  userId?: string;
  projectId?: string;
  toolId?: string;
  category?: ActivityCategory;
  billable?: boolean;
  page: number;
  pageSize: number;
}

/** Normalized activity timeline. RLS limits rows to what the caller may see. */
export async function listActivity(scope: DbScope, q: ActivityQuery) {
  const where: Prisma.FocusEventWhereInput = {
    ...(q.start || q.end ? { startedAt: { ...(q.start ? { gte: q.start } : {}), ...(q.end ? { lt: q.end } : {}) } } : {}),
    ...(q.userId ? { userId: q.userId } : {}),
    ...(q.projectId ? { projectId: q.projectId } : {}),
    ...(q.toolId ? { toolId: q.toolId } : {}),
    ...(q.category ? { activityCategory: q.category } : {}),
    ...(q.billable !== undefined ? { isBillable: q.billable } : {}),
  };
  const [items, total, agg] = await Promise.all([
    scope.tx.focusEvent.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true,
        startedAt: true,
        endedAt: true,
        durationSeconds: true,
        activityCategory: true,
        isBillable: true,
        isContextSwitch: true,
        isSimulated: true,
        sessionId: true,
        user: { select: { id: true, displayName: true } },
        project: { select: { id: true, name: true } },
        tool: { select: { id: true, name: true } },
        file: { select: { fileName: true, fileType: true } },
        device: { select: { name: true } },
      },
    }),
    scope.tx.focusEvent.count({ where }),
    scope.tx.focusEvent.aggregate({ where, _sum: { durationSeconds: true } }),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize, totalSeconds: agg._sum.durationSeconds ?? 0 };
}

/** Raw JSONB event packets — administrators (and the owner, via RLS) only. */
export async function listRawEvents(scope: DbScope, q: { userId?: string; status?: string; page: number; pageSize: number }) {
  if (!can(scope.actor.role, "activity:raw")) throw forbidden("Raw event metadata is restricted to administrators");
  const where: Prisma.RawActivityEventWhereInput = {
    ...(q.userId ? { userId: q.userId } : {}),
    ...(q.status ? { processingStatus: q.status as Prisma.EnumProcessingStatusFilter["equals"] } : {}),
  };
  const [items, total, statusCounts] = await Promise.all([
    scope.tx.rawActivityEvent.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true,
        clientEventId: true,
        eventType: true,
        eventTimestamp: true,
        receivedAt: true,
        processedAt: true,
        processingStatus: true,
        attempts: true,
        lastError: true,
        isSimulated: true,
        payload: true,
        user: { select: { displayName: true } },
      },
    }),
    scope.tx.rawActivityEvent.count({ where }),
    scope.tx.rawActivityEvent.groupBy({ by: ["processingStatus"], _count: { _all: true } }),
  ]);
  return {
    items,
    total,
    page: q.page,
    pageSize: q.pageSize,
    statusCounts: Object.fromEntries(statusCounts.map((s) => [s.processingStatus, s._count._all])),
  };
}

/** Administrator action: re-queue FAILED events for another processing attempt. */
export async function retryFailedEvents(scope: DbScope) {
  if (!can(scope.actor.role, "activity:raw")) throw forbidden();
  const failed = await scope.tx.rawActivityEvent.findMany({ where: { processingStatus: "FAILED" }, select: { id: true }, take: 1000 });
  return failed.map((f) => f.id);
}
