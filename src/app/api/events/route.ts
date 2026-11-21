import { route, json } from "@/lib/api/handler";
import { eventBatchSchema } from "@/lib/validation/events";
import { ingestEvents } from "@/services/events/ingestion-service";
import { unauthorized } from "@/lib/api/errors";

/**
 * Activity ingestion for collectors (future native desktop agent).
 * Auth: session cookie OR `Authorization: Bearer gfd_…` device token.
 * Always ingests for the authenticated user only.
 */
export const POST = route(
  { auth: "device", rateLimit: { name: "events", limit: 600, windowSeconds: 60, by: "user" } },
  async (ctx) => {
    const { events } = await ctx.json(eventBatchSchema);
    const actor = ctx.user
      ? { userId: ctx.user.userId, organizationId: ctx.user.organizationId, role: ctx.user.role, teamId: ctx.user.teamId }
      : ctx.device
        ? { userId: ctx.device.userId, organizationId: ctx.device.organizationId, role: ctx.device.role }
        : null;
    if (!actor) throw unauthorized();
    const result = await ingestEvents(actor, actor.userId, events, {
      source: "agent",
      tokenDeviceId: ctx.device?.deviceId,
      requestId: ctx.requestId,
    });
    return json(result, { status: result.accepted > 0 ? 202 : result.rejected === events.length ? 422 : 200 });
  },
);
