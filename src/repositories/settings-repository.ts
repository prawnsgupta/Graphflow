import type { OrganizationSettings } from "@prisma/client";
import type { Tx } from "@/lib/db/context";

export type OrgSettings = Omit<OrganizationSettings, "updatedAt">;

export function defaultSettings(organizationId: string): OrgSettings {
  return {
    organizationId,
    deepFocusMinMinutes: 25,
    deepFocusMaxGapMinutes: 2,
    idleTimeoutMinutes: 5,
    heartbeatTimeoutMinutes: 5,
    contextSwitchThresholdPerHour: 6,
    contextSwitchCostSeconds: 120,
    fragmentThresholdSeconds: 120,
    fragmentMinCountPerHour: 3,
    budgetAlertThresholdPct: 80,
    rawEventRetentionDays: 90,
    auditLogRetentionDays: 730,
    defaultCurrency: "USD",
  };
}

export async function getOrgSettings(tx: Tx, organizationId: string): Promise<OrgSettings> {
  const row = await tx.organizationSettings.findUnique({ where: { organizationId } });
  return row ?? defaultSettings(organizationId);
}
