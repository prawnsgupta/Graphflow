import type { Prisma, ProjectStatus } from "@prisma/client";
import type { DbScope } from "@/lib/db/context";
import { writeAudit } from "@/services/audit/audit-writer";
import { forbidden, notFound, unprocessable } from "@/lib/api/errors";
import { isAdmin } from "@/lib/permissions";
import { DEFAULT_PROJECT_RULES } from "@/repositories/billing-config-repository";

const projectSelect = {
  id: true,
  name: true,
  description: true,
  clientName: true,
  budgetHours: true,
  hourlyRate: true,
  currency: true,
  status: true,
  startDate: true,
  deadline: true,
  createdAt: true,
  team: { select: { id: true, name: true } },
  projectManager: { select: { id: true, displayName: true } },
  _count: { select: { members: true } },
} satisfies Prisma.ProjectSelect;

const toDate = (k: string | null | undefined) => (k === undefined ? undefined : k === null ? null : new Date(`${k}T00:00:00Z`));

export async function listProjects(scope: DbScope, q: { search?: string; status?: ProjectStatus; teamId?: string; page: number; pageSize: number }) {
  const where: Prisma.ProjectWhereInput = {
    ...(q.search
      ? { OR: [{ name: { contains: q.search, mode: "insensitive" } }, { clientName: { contains: q.search, mode: "insensitive" } }] }
      : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.teamId ? { teamId: q.teamId } : {}),
  };
  const [items, total] = await Promise.all([
    scope.tx.project.findMany({ where, select: projectSelect, orderBy: [{ status: "asc" }, { name: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    scope.tx.project.count({ where }),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}

export async function getProject(scope: DbScope, id: string) {
  const project = await scope.tx.project.findFirst({
    where: { id },
    select: {
      ...projectSelect,
      members: {
        orderBy: { assignedAt: "asc" },
        select: { id: true, assignedRole: true, assignedAt: true, user: { select: { id: true, displayName: true, email: true, role: true, isActive: true } } },
      },
      billingConfig: true,
    },
  });
  if (!project) throw notFound("Project not found");
  const canManage = isAdmin(scope.actor.role) || project.projectManager?.id === scope.actor.userId;
  return { ...project, billingConfig: project.billingConfig ?? { ...DEFAULT_PROJECT_RULES, projectId: id }, canManage };
}

async function validateRefs(scope: DbScope, input: { teamId?: string | null; projectManagerId?: string | null }) {
  if (input.teamId) {
    const t = await scope.tx.team.findFirst({ where: { id: input.teamId }, select: { id: true } });
    if (!t) throw unprocessable("Team not found");
  }
  if (input.projectManagerId) {
    const pm = await scope.tx.user.findFirst({
      where: { id: input.projectManagerId, isActive: true, role: { in: ["PROJECT_MANAGER", "ORG_ADMIN", "SUPER_ADMIN"] } },
      select: { id: true },
    });
    if (!pm) throw unprocessable("Project manager must be an active project manager or administrator");
  }
}

export async function createProject(
  scope: DbScope,
  input: {
    name: string;
    description?: string | null;
    clientName?: string | null;
    teamId?: string | null;
    projectManagerId?: string | null;
    budgetHours: number;
    hourlyRate: number;
    currency: string;
    status: ProjectStatus;
    startDate?: string | null;
    deadline?: string | null;
  },
) {
  const { actor, tx } = scope;
  if (!isAdmin(actor.role) && actor.role !== "PROJECT_MANAGER") throw forbidden();
  const projectManagerId = isAdmin(actor.role) ? (input.projectManagerId ?? null) : actor.userId;
  await validateRefs(scope, { teamId: input.teamId, projectManagerId });
  const project = await tx.project.create({
    data: {
      organizationId: actor.organizationId,
      name: input.name,
      description: input.description ?? null,
      clientName: input.clientName ?? null,
      teamId: input.teamId ?? null,
      projectManagerId,
      budgetHours: input.budgetHours.toFixed(2),
      hourlyRate: input.hourlyRate.toFixed(2),
      currency: input.currency,
      status: input.status,
      startDate: toDate(input.startDate),
      deadline: toDate(input.deadline),
    },
    select: { id: true, name: true },
  });
  await tx.projectBillingConfig.create({
    data: {
      projectId: project.id,
      organizationId: actor.organizationId,
      billableCategories: DEFAULT_PROJECT_RULES.billableCategories,
      collaborationBillable: DEFAULT_PROJECT_RULES.collaborationBillable,
      administrativeBillable: DEFAULT_PROJECT_RULES.administrativeBillable,
    },
    select: { projectId: true },
  });
  await writeAudit(scope, { action: "project.created", entityType: "Project", entityId: project.id, projectId: project.id, metadata: { ...input } });
  return project;
}

export async function updateProject(
  scope: DbScope,
  id: string,
  input: Partial<{
    name: string;
    description: string | null;
    clientName: string | null;
    teamId: string | null;
    projectManagerId: string | null;
    budgetHours: number;
    hourlyRate: number;
    currency: string;
    status: ProjectStatus;
    startDate: string | null;
    deadline: string | null;
  }>,
) {
  const { actor, tx } = scope;
  const existing = await tx.project.findFirst({
    where: { id },
    select: { id: true, projectManagerId: true, budgetHours: true, hourlyRate: true, status: true },
  });
  if (!existing) throw notFound("Project not found");
  const admin = isAdmin(actor.role);
  if (!admin && existing.projectManagerId !== actor.userId) throw forbidden("Only the project manager or an administrator can edit this project");
  if (!admin && input.projectManagerId !== undefined && input.projectManagerId !== actor.userId)
    throw forbidden("Only administrators can reassign the project manager");
  await validateRefs(scope, input);
  const updated = await tx.project.update({
    where: { id },
    data: {
      ...input,
      budgetHours: input.budgetHours?.toFixed(2),
      hourlyRate: input.hourlyRate?.toFixed(2),
      startDate: toDate(input.startDate),
      deadline: toDate(input.deadline),
    },
    select: { id: true, name: true },
  });
  await writeAudit(scope, {
    action: "project.updated",
    entityType: "Project",
    entityId: id,
    projectId: id,
    metadata: {
      changes: input,
      previous: { budgetHours: existing.budgetHours.toString(), hourlyRate: existing.hourlyRate.toString(), status: existing.status },
    },
  });
  return updated;
}

export async function deleteProject(scope: DbScope, id: string) {
  if (!isAdmin(scope.actor.role)) throw forbidden();
  const existing = await scope.tx.project.findFirst({ where: { id }, select: { id: true, name: true, _count: { select: { timesheets: true } } } });
  if (!existing) throw notFound("Project not found");
  if (existing._count.timesheets > 0) throw unprocessable("Projects with timesheets cannot be deleted; archive the project instead");
  await scope.tx.project.delete({ where: { id } });
  await writeAudit(scope, { action: "project.deleted", entityType: "Project", entityId: id, metadata: { name: existing.name } });
}

async function assertCanManage(scope: DbScope, projectId: string) {
  const p = await scope.tx.project.findFirst({ where: { id: projectId }, select: { id: true, projectManagerId: true } });
  if (!p) throw notFound("Project not found");
  if (!isAdmin(scope.actor.role) && p.projectManagerId !== scope.actor.userId) throw forbidden("Only the project manager or an administrator can do this");
}

export async function addMember(scope: DbScope, projectId: string, input: { userId: string; assignedRole: string }) {
  await assertCanManage(scope, projectId);
  const user = await scope.tx.user.findFirst({ where: { id: input.userId, isActive: true }, select: { id: true, displayName: true } });
  if (!user) throw unprocessable("Employee not found or inactive");
  const member = await scope.tx.projectMember.upsert({
    where: { projectId_userId: { projectId, userId: input.userId } },
    create: { projectId, userId: input.userId, assignedRole: input.assignedRole },
    update: { assignedRole: input.assignedRole },
    select: { id: true },
  });
  await writeAudit(scope, {
    action: "project.member_assigned",
    entityType: "Project",
    entityId: projectId,
    projectId,
    metadata: { userId: input.userId, displayName: user.displayName, assignedRole: input.assignedRole },
  });
  return member;
}

export async function removeMember(scope: DbScope, projectId: string, userId: string) {
  await assertCanManage(scope, projectId);
  const res = await scope.tx.projectMember.deleteMany({ where: { projectId, userId } });
  if (res.count === 0) throw notFound("Member not found");
  await writeAudit(scope, { action: "project.member_removed", entityType: "Project", entityId: projectId, projectId, metadata: { userId } });
}

export async function updateBillingConfig(
  scope: DbScope,
  projectId: string,
  input: {
    billableCategories: ("DEEP_FOCUS" | "ACTIVE_WORK")[];
    collaborationBillable: boolean;
    administrativeBillable: boolean;
    billableToolIds: string[];
    nonBillableToolIds: string[];
    roundingRule: "NONE" | "UP_6_MIN" | "UP_15_MIN" | "NEAREST_15_MIN";
    requiresApproval: boolean;
  },
) {
  await assertCanManage(scope, projectId);
  const overlap = input.billableToolIds.filter((t) => input.nonBillableToolIds.includes(t));
  if (overlap.length) throw unprocessable("A tool cannot be both always-billable and never-billable");
  const config = await scope.tx.projectBillingConfig.upsert({
    where: { projectId },
    create: { projectId, organizationId: scope.actor.organizationId, ...input },
    update: input,
  });
  await writeAudit(scope, { action: "project.billing_config_updated", entityType: "Project", entityId: projectId, projectId, metadata: input });
  return config;
}

export async function projectAuditHistory(scope: DbScope, projectId: string) {
  return scope.tx.auditLog.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, action: true, entityType: true, entityId: true, metadata: true, createdAt: true, actor: { select: { displayName: true } } },
  });
}
