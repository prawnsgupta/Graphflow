import { z } from "zod";
import { route } from "@/lib/api/handler";
import { optionalUuid, paginationQuery } from "@/lib/validation/common";
import { listTimesheets } from "@/services/billing/timesheet-service";

const query = paginationQuery.extend({
  status: z.enum(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "ADJUSTMENT_REQUIRED"]).optional().or(z.literal("").transform(() => undefined)),
  projectId: optionalUuid,
  userId: optionalUuid,
  scope: z.enum(["all", "mine", "review"]).default("all"),
});

export const GET = route({ capability: "billing:view" }, (ctx) => {
  const q = ctx.query(query);
  return ctx.scope((s) => listTimesheets(s, q));
});
