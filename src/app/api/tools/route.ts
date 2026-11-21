import { route, json } from "@/lib/api/handler";
import { toolSchema } from "@/lib/validation/forms";
import { createTool, listTools } from "@/services/settings/settings-service";

export const GET = route({}, (ctx) => ctx.scope((s) => listTools(s)));

export const POST = route({ capability: "tools:manage" }, async (ctx) => {
  const input = await ctx.json(toolSchema);
  return json(await ctx.scope((s) => createTool(s, input)), { status: 201 });
});
