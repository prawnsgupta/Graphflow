import { route } from "@/lib/api/handler";
import { consentSchema } from "@/lib/validation/forms";
import { setConsent } from "@/services/settings/settings-service";

export const POST = route({}, async (ctx) => {
  const { trackingConsent } = await ctx.json(consentSchema);
  return ctx.scope((s) => setConsent(s, trackingConsent));
});
