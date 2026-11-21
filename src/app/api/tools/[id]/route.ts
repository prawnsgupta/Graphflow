import { route } from "@/lib/api/handler";
import { toolUpdateSchema } from "@/lib/validation/forms";
import { updateTool } from "@/services/settings/settings-service";
import { uuid } from "@/lib/validation/common";

export const PATCH = route<{ id: string }>({ capability: "tools:manage" }, async (ctx) => {
  const input = await ctx.json(toolUpdateSchema);
  return ctx.scope((s) => updateTool(s, uuid.parse(ctx.params.id), input));
});
