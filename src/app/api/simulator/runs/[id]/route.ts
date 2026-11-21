import { route } from "@/lib/api/handler";
import { updateSimulationSchema } from "@/lib/validation/forms";
import { runStats, updateRunStatus } from "@/services/simulator/simulator-service";
import { uuid } from "@/lib/validation/common";

export const GET = route<{ id: string }>({ capability: "simulator:use" }, (ctx) =>
  ctx.scope((s) => runStats(s, uuid.parse(ctx.params.id))),
);

export const PATCH = route<{ id: string }>({ capability: "simulator:use" }, async (ctx) => {
  const { status } = await ctx.json(updateSimulationSchema);
  return ctx.scope((s) => updateRunStatus(s, uuid.parse(ctx.params.id), status));
});
