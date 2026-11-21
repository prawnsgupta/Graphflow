import type { Prisma } from "@prisma/client";
import type { DbScope, Tx } from "@/lib/db/context";

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  projectId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/** Append an audit record inside the caller's transaction (same commit as the change). */
export async function writeAudit(scope: DbScope, entry: AuditEntry): Promise<void> {
  await writeAuditRaw(scope.tx, {
    organizationId: scope.actor.organizationId,
    actorId: scope.actor.userId,
    requestId: scope.requestId ?? null,
    ...entry,
  });
}

export async function writeAuditRaw(
  tx: Tx,
  entry: AuditEntry & { organizationId: string; actorId: string | null; requestId?: string | null },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      organizationId: entry.organizationId,
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      projectId: entry.projectId ?? null,
      metadata: entry.metadata ?? {},
      requestId: entry.requestId ?? null,
    },
    select: { id: true },
  });
}
