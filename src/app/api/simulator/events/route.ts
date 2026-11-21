import { route, json } from "@/lib/api/handler";
import { simulatorBatchSchema } from "@/lib/validation/events";
import { ingestEvents } from "@/services/events/ingestion-service";
import { getRun } from "@/services/simulator/simulator-service";
import { withRls } from "@/lib/db/context";
import { AppError, forbidden, unprocessable } from "@/lib/api/errors";

/**
 * Simulator ingestion. Same validation, storage, queue and worker path as
 * /api/events — plus run ownership checks. Simulated events must be flagged
 * `simulated: true`.
 */
export const POST = route(
  { capability: "simulator:use", rateLimit: { name: "sim-events", limit: 900, windowSeconds: 60, by: "user" } },
  async (ctx) => {
    const body = await ctx.json(simulatorBatchSchema);
    const user = ctx.user!;
    const actor = { userId: user.userId, organizationId: user.organizationId, role: user.role, teamId: user.teamId };
    const run = await withRls(actor, (tx) => getRun({ tx, actor }, body.runId));
    if (run.actorId !== actor.userId) throw forbidden("This simulation run belongs to someone else");
    if (run.status === "STOPPED" || run.status === "COMPLETED") throw new AppError(409, "RUN_ENDED", "This simulation run has ended");
    if (body.events.some((e) => !e.simulated)) throw unprocessable("Simulator events must be marked as simulated");
    const target = body.userId ?? run.userId;
    const result = await ingestEvents(actor, target, body.events, { source: "simulator", simulationRunId: run.id, requestId: ctx.requestId });
    return json(result, { status: result.accepted > 0 ? 202 : 200 });
  },
);
