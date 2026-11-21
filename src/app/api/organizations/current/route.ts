import { route } from "@/lib/api/handler";
import { organizationSchema } from "@/lib/validation/forms";
import { getSettings, updateOrganization } from "@/services/settings/settings-service";

export const GET = route({}, (ctx) => ctx.scope(async (s) => (await getSettings(s)).organization));

export const PATCH = route({ capability: "settings:organization" }, async (ctx) => {
  const input = await ctx.json(organizationSchema);
  return ctx.scope((s) => updateOrganization(s, input));
});
