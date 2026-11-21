import type { Tx } from "@/lib/db/context";
import { DEFAULT_BILLING_RULES, type BillingRules } from "@/services/events/classification";
import type { RoundingRule } from "@/services/billing/billing-math";

export interface ProjectBillingRules extends BillingRules {
  roundingRule: RoundingRule;
  requiresApproval: boolean;
}

export const DEFAULT_PROJECT_RULES: ProjectBillingRules = {
  ...DEFAULT_BILLING_RULES,
  roundingRule: "NONE",
  requiresApproval: true,
};

export async function loadBillingRules(tx: Tx, projectIds: string[]): Promise<Map<string, ProjectBillingRules>> {
  const map = new Map<string, ProjectBillingRules>();
  if (projectIds.length === 0) return map;
  const rows = await tx.projectBillingConfig.findMany({ where: { projectId: { in: projectIds } } });
  for (const r of rows) {
    map.set(r.projectId, {
      billableCategories: r.billableCategories,
      collaborationBillable: r.collaborationBillable,
      administrativeBillable: r.administrativeBillable,
      billableToolIds: r.billableToolIds,
      nonBillableToolIds: r.nonBillableToolIds,
      roundingRule: r.roundingRule,
      requiresApproval: r.requiresApproval,
    });
  }
  return map;
}
