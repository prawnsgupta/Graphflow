import type { Prisma } from "@prisma/client";
import type { DbScope } from "@/lib/db/context";

export async function listAuditLogs(
  scope: DbScope,
  q: { action?: string; entityType?: string; actorId?: string; projectId?: string; from?: Date; to?: Date; page: number; pageSize: number },
) {
  const where: Prisma.AuditLogWhereInput = {
    ...(q.action ? { action: { contains: q.action, mode: "insensitive" } } : {}),
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.actorId ? { actorId: q.actorId } : {}),
    ...(q.projectId ? { projectId: q.projectId } : {}),
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } } : {}),
  };
  const [items, total, entityTypes] = await Promise.all([
    scope.tx.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        projectId: true,
        metadata: true,
        requestId: true,
        createdAt: true,
        actor: { select: { id: true, displayName: true, email: true } },
      },
    }),
    scope.tx.auditLog.count({ where }),
    scope.tx.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize, entityTypes: entityTypes.map((e) => e.entityType) };
}
