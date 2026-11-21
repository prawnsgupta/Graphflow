import { z } from "zod";
import { route } from "@/lib/api/handler";
import { optionalUuid, paginationQuery } from "@/lib/validation/common";
import { listRawEvents } from "@/services/activity/activity-service";

const query = paginationQuery.extend({
  userId: optionalUuid,
  status: z.enum(["PENDING", "PROCESSING", "PROCESSED", "RETRYING", "FAILED", "SKIPPED"]).optional().or(z.literal("").transform(() => undefined)),
});

export const GET = route({ capability: "activity:raw" }, (ctx) => {
  const q = ctx.query(query);
  return ctx.scope((s) => listRawEvents(s, q));
});
