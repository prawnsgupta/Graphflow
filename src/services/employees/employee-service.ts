import type { Prisma, UserRole } from "@prisma/client";
import type { DbScope } from "@/lib/db/context";
import { userPublicSelect } from "@/repositories/user-repository";
import { writeAudit } from "@/services/audit/audit-writer";
import { generateToken, hashToken } from "@/lib/auth/tokens";
import { conflict, forbidden, notFound, unprocessable } from "@/lib/api/errors";
import { isAdmin } from "@/lib/permissions";

export interface EmployeeListQuery {
  search?: string;
  teamId?: string;
  role?: UserRole;
  status?: "active" | "inactive" | "all";
  page: number;
  pageSize: number;
}

/**
 * Directory visibility: admins and project managers (who staff projects) see
 * the whole directory; team leads their team; employees themselves. Activity
 * data is protected separately by RLS regardless of directory visibility.
 */
async function visibilityFilter(scope: DbScope): Promise<Prisma.UserWhereInput> {
  const { actor } = scope;
  if (isAdmin(actor.role)) return {};
  if (actor.role === "TEAM_LEAD") return { OR: [{ teamId: actor.teamId ?? undefined }, { id: actor.userId }] };
  if (actor.role === "PROJECT_MANAGER") return {};
  return { id: actor.userId };
}

export async function listEmployees(scope: DbScope, q: EmployeeListQuery) {
  const vis = await visibilityFilter(scope);
  const where: Prisma.UserWhereInput = {
    AND: [
      vis,
      q.search
        ? { OR: [{ displayName: { contains: q.search, mode: "insensitive" } }, { email: { contains: q.search, mode: "insensitive" } }] }
        : {},
      q.teamId ? { teamId: q.teamId } : {},
      q.role ? { role: q.role } : {},
      q.status === "inactive" ? { isActive: false } : q.status === "all" ? {} : { isActive: true },
    ],
  };
  const [items, total] = await Promise.all([
    scope.tx.user.findMany({
      where,
      select: { ...userPublicSelect, _count: { select: { projectMemberships: true } } },
      orderBy: { displayName: "asc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    scope.tx.user.count({ where }),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}

export async function getEmployee(scope: DbScope, id: string) {
  const vis = await visibilityFilter(scope);
  const user = await scope.tx.user.findFirst({
    where: { AND: [{ id }, vis] },
    select: {
      ...userPublicSelect,
      projectMemberships: { select: { assignedRole: true, project: { select: { id: true, name: true, status: true } } } },
    },
  });
  if (!user) throw notFound("Employee not found");
  return user;
}

export async function updateEmployee(
  scope: DbScope,
  id: string,
  input: { displayName?: string; title?: string | null; role?: UserRole; teamId?: string | null; isActive?: boolean },
) {
  const { actor, tx } = scope;
  if (!isAdmin(actor.role)) throw forbidden("Only administrators can manage employees");
  const existing = await tx.user.findFirst({ where: { id }, select: { id: true, role: true, isActive: true, teamId: true } });
  if (!existing) throw notFound("Employee not found");
  if (id === actor.userId && (input.isActive === false || (input.role && input.role !== existing.role)))
    throw unprocessable("You cannot deactivate yourself or change your own role");
  if (input.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") throw forbidden("Only a super admin can grant super admin");
  if (input.teamId) {
    const team = await tx.team.findFirst({ where: { id: input.teamId }, select: { id: true } });
    if (!team) throw unprocessable("Team not found");
  }
  const updated = await tx.user.update({ where: { id }, data: input, select: userPublicSelect });
  if (input.isActive === false) {
    await tx.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }).catch(() => undefined);
  }
  await writeAudit(scope, {
    action: input.isActive === false ? "user.deactivated" : input.isActive === true && !existing.isActive ? "user.activated" : "user.updated",
    entityType: "User",
    entityId: id,
    metadata: { changes: input, previous: { role: existing.role, teamId: existing.teamId, isActive: existing.isActive } },
  });
  return updated;
}

export async function inviteEmployee(
  scope: DbScope,
  input: { email: string; displayName?: string; role: UserRole; teamId?: string | null },
  appUrl: string,
) {
  const { tx, actor } = scope;
  if (!isAdmin(actor.role)) throw forbidden("Only administrators can invite employees");
  if (input.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") throw forbidden();
  const exists = await tx.user.findFirst({ where: { email: input.email }, select: { id: true } });
  if (exists) throw conflict("A user with this email already exists");
  const token = generateToken("gfi");
  const invitation = await tx.invitation.create({
    data: {
      organizationId: actor.organizationId,
      email: input.email,
      displayName: input.displayName ?? null,
      role: input.role,
      teamId: input.teamId ?? null,
      tokenHash: hashToken(token),
      invitedById: actor.userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
    },
    select: { id: true, email: true, role: true, expiresAt: true },
  });
  await writeAudit(scope, {
    action: "user.invited",
    entityType: "Invitation",
    entityId: invitation.id,
    metadata: { email: input.email, role: input.role, teamId: input.teamId ?? null },
  });
  // Email delivery is not configured; the link is returned once to the admin.
  return { ...invitation, inviteUrl: `${appUrl}/invite/${token}` };
}

export async function listInvitations(scope: DbScope) {
  return scope.tx.invitation.findMany({
    where: { acceptedAt: null, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, displayName: true, role: true, expiresAt: true, createdAt: true, invitedBy: { select: { displayName: true } } },
  });
}

export async function revokeInvitation(scope: DbScope, id: string) {
  const res = await scope.tx.invitation.updateMany({ where: { id, acceptedAt: null }, data: { revokedAt: new Date() } });
  if (res.count === 0) throw notFound("Invitation not found");
  await writeAudit(scope, { action: "user.invitation_revoked", entityType: "Invitation", entityId: id });
}
