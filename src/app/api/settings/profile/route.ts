import { route } from "@/lib/api/handler";
import { profileSchema } from "@/lib/validation/forms";
import { updateProfile } from "@/services/settings/settings-service";

export const PATCH = route({}, async (ctx) => {
  const input = await ctx.json(profileSchema);
  return ctx.scope((s) => updateProfile(s, input));
});
