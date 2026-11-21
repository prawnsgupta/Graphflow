import { route, json } from "@/lib/api/handler";
import { startSimulationSchema } from "@/lib/validation/forms";
import { startRun } from "@/services/simulator/simulator-service";

export const POST = route({ capability: "simulator:use" }, async (ctx) => {
  const input = await ctx.json(startSimulationSchema);
  return json(await ctx.scope((s) => startRun(s, input)), { status: 201 });
});
