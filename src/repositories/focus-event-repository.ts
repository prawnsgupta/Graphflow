import type { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db/context";
import type { MetricEvent } from "@/services/analytics/metrics";

export interface FocusFilter {
  start: Date;
  end: Date;
  projectId?: string;
  userId?: string;
  userIds?: string[];
  toolId?: string;
}

export function focusWhere(f: FocusFilter): Prisma.FocusEventWhereInput {
  return {
    startedAt: { gte: f.start, lt: f.end },
    ...(f.projectId ? { projectId: f.projectId } : {}),
    ...(f.userId ? { userId: f.userId } : f.userIds ? { userId: { in: f.userIds } } : {}),
    ...(f.toolId ? { toolId: f.toolId } : {}),
  };
}

/** Lean projection for analytics. Visibility is enforced by RLS on the transaction. */
export async function loadMetricEvents(tx: Tx, f: FocusFilter): Promise<MetricEvent[]> {
  const rows = await tx.focusEvent.findMany({
    where: focusWhere(f),
    select: {
      userId: true,
      projectId: true,
      toolId: true,
      startedAt: true,
      endedAt: true,
      durationSeconds: true,
      activityCategory: true,
      isBillable: true,
      isContextSwitch: true,
    },
    orderBy: { startedAt: "asc" },
    take: 200_000,
  });
  return rows.map((r) => ({
    userId: r.userId,
    projectId: r.projectId,
    toolId: r.toolId,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    durationSeconds: r.durationSeconds,
    category: r.activityCategory,
    isBillable: r.isBillable,
    isContextSwitch: r.isContextSwitch,
  }));
}
