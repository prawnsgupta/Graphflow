import type { DbScope } from "@/lib/db/context";
import { writeAudit } from "@/services/audit/audit-writer";
import { forbidden, notFound, unprocessable } from "@/lib/api/errors";
import { isAdmin } from "@/lib/permissions";

export async function listTeams(scope: DbScope) {
  return scope.tx.team.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      manager: { select: { id: true, displayName: true } },
      _count: { select: { members: true, projects: true } },
    },
  });
}

async function assertManager(scope: DbScope, managerId: string | null | undefined) {
  if (!managerId) return;
  const m = await scope.tx.user.findFirst({ where: { id: managerId, isActive: true }, select: { id: true } });
  if (!m) throw unprocessable("Team manager not found");
}

export async function createTeam(scope: DbScope, input: { name: string; description?: string | null; managerId?: string | null }) {
  if (!isAdmin(scope.actor.role)) throw forbidden("Only administrators can create teams");
  await assertManager(scope, input.managerId);
  const team = await scope.tx.team.create({
    data: { organizationId: scope.actor.organizationId, name: input.name, description: input.description ?? null, managerId: input.managerId ?? null },
    select: { id: true, name: true },
  });
  await writeAudit(scope, { action: "team.created", entityType: "Team", entityId: team.id, metadata: input });
  return team;
}

export async function updateTeam(scope: DbScope, id: string, input: { name?: string; description?: string | null; managerId?: string | null }) {
  if (!isAdmin(scope.actor.role)) throw forbidden();
  await assertManager(scope, input.managerId);
  const existing = await scope.tx.team.findFirst({ where: { id }, select: { id: true } });
  if (!existing) throw notFound("Team not found");
  const team = await scope.tx.team.update({ where: { id }, data: input, select: { id: true, name: true } });
  await writeAudit(scope, { action: "team.updated", entityType: "Team", entityId: id, metadata: input });
  return team;
}

export async function deleteTeam(scope: DbScope, id: string) {
  if (!isAdmin(scope.actor.role)) throw forbidden();
  const existing = await scope.tx.team.findFirst({ where: { id }, select: { id: true, name: true, _count: { select: { members: true } } } });
  if (!existing) throw notFound("Team not found");
  if (existing._count.members > 0) throw unprocessable("Reassign the team's members before deleting it");
  await scope.tx.team.delete({ where: { id } });
  await writeAudit(scope, { action: "team.deleted", entityType: "Team", entityId: id, metadata: { name: existing.name } });
}
