import type { DbScope } from "@/lib/db/context";
import { writeAudit } from "@/services/audit/audit-writer";
import { getOrgSettings } from "@/repositories/settings-repository";
import { userPublicSelect } from "@/repositories/user-repository";
import { forbidden, unprocessable } from "@/lib/api/errors";
import { isAdmin } from "@/lib/permissions";
import { isValidTimezone } from "@/lib/utils/time";
import type { z } from "zod";
import type { orgSettingsSchema } from "@/lib/validation/forms";

export async function getSettings(scope: DbScope) {
  const { tx, actor } = scope;
  const [organization, settings, me] = await Promise.all([
    tx.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { id: true, name: true, slug: true, timezone: true, isDemo: true } }),
    getOrgSettings(tx, actor.organizationId),
    tx.user.findUniqueOrThrow({ where: { id: actor.userId }, select: userPublicSelect }),
  ]);
  return { organization, settings, me };
}

export async function updateOrganization(scope: DbScope, input: { name?: string; timezone?: string }) {
  if (!isAdmin(scope.actor.role)) throw forbidden();
  if (input.timezone && !isValidTimezone(input.timezone)) throw unprocessable("Unknown IANA timezone");
  const org = await scope.tx.organization.update({ where: { id: scope.actor.organizationId }, data: input, select: { id: true, name: true, timezone: true } });
  await writeAudit(scope, { action: "organization.updated", entityType: "Organization", entityId: org.id, metadata: input });
  return org;
}

export async function updateOrgSettings(scope: DbScope, input: z.infer<typeof orgSettingsSchema>) {
  if (!isAdmin(scope.actor.role)) throw forbidden();
  const orgId = scope.actor.organizationId;
  const previous = await getOrgSettings(scope.tx, orgId);
  const settings = await scope.tx.organizationSettings.upsert({
    where: { organizationId: orgId },
    create: { organizationId: orgId, ...input },
    update: input,
  });
  await writeAudit(scope, { action: "settings.updated", entityType: "OrganizationSettings", entityId: orgId, metadata: { changes: input, previous } });
  return settings;
}

export async function updateProfile(scope: DbScope, input: { displayName: string; title?: string | null }) {
  const me = await scope.tx.user.update({ where: { id: scope.actor.userId }, data: input, select: userPublicSelect });
  await writeAudit(scope, { action: "user.profile_updated", entityType: "User", entityId: scope.actor.userId, metadata: input });
  return me;
}

/**
 * Tracking consent is controlled by the employee. Withdrawing consent stops
 * ingestion immediately and events timestamped after the withdrawal are
 * never processed.
 */
export async function setConsent(scope: DbScope, trackingConsent: boolean) {
  const me = await scope.tx.user.update({
    where: { id: scope.actor.userId },
    data: { trackingConsent, consentUpdatedAt: new Date() },
    select: userPublicSelect,
  });
  await writeAudit(scope, {
    action: trackingConsent ? "consent.granted" : "consent.withdrawn",
    entityType: "User",
    entityId: scope.actor.userId,
  });
  return me;
}

export async function listTools(scope: DbScope) {
  return scope.tx.tool.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] });
}

export async function createTool(scope: DbScope, input: { name: string; category: "DESIGN" | "DEVELOPMENT" | "THREE_D" | "BROWSER" | "COMMUNICATION" | "PRODUCTIVITY" | "DOCUMENTATION" | "OTHER"; executableName: string; defaultBillableStatus: boolean }) {
  if (!isAdmin(scope.actor.role)) throw forbidden();
  const tool = await scope.tx.tool.create({ data: { organizationId: scope.actor.organizationId, ...input } });
  await writeAudit(scope, { action: "tool.created", entityType: "Tool", entityId: tool.id, metadata: input });
  return tool;
}

export async function updateTool(scope: DbScope, id: string, input: { defaultBillableStatus?: boolean; category?: "DESIGN" | "DEVELOPMENT" | "THREE_D" | "BROWSER" | "COMMUNICATION" | "PRODUCTIVITY" | "DOCUMENTATION" | "OTHER" }) {
  if (!isAdmin(scope.actor.role)) throw forbidden();
  const tool = await scope.tx.tool.update({ where: { id }, data: input });
  await writeAudit(scope, { action: "tool.updated", entityType: "Tool", entityId: id, metadata: input });
  return tool;
}
