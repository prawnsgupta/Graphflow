import { route } from "@/lib/api/handler";
import { billingConfigSchema } from "@/lib/validation/forms";
import { getProject, updateBillingConfig } from "@/services/projects/project-service";
import { uuid } from "@/lib/validation/common";

export const GET = route<{ id: string }>({ capability: "projects:view" }, (ctx) =>
  ctx.scope(async (s) => (await getProject(s, uuid.parse(ctx.params.id))).billingConfig),
);

export const PUT = route<{ id: string }>({ capability: "projects:manage" }, async (ctx) => {
  const input = await ctx.json(billingConfigSchema);
  return ctx.scope((s) => updateBillingConfig(s, uuid.parse(ctx.params.id), input));
});
