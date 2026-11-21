import { route } from "@/lib/api/handler";
import { orgSettingsSchema } from "@/lib/validation/forms";
import { getSettings, updateOrgSettings } from "@/services/settings/settings-service";

export const GET = route({}, (ctx) => ctx.scope((s) => getSettings(s)));

export const PATCH = route({ capability: "settings:organization" }, async (ctx) => {
  const input = await ctx.json(orgSettingsSchema);
  return ctx.scope((s) => updateOrgSettings(s, input));
});
