import { route } from "@/lib/api/handler";
import { adjustSchema, approveSchema, reasonSchema, submitSchema } from "@/lib/validation/forms";
import {
  adjustTimesheet,
  approveTimesheet,
  rejectTimesheet,
  requestAdjustment,
  submitTimesheet,
} from "@/services/billing/timesheet-service";
import { uuid } from "@/lib/validation/common";
import { notFound } from "@/lib/api/errors";

/** Timesheet workflow transitions: submit | approve | reject | request-adjustment | adjust */
export const POST = route<{ id: string; action: string }>({ capability: "billing:view" }, async (ctx) => {
  const id = uuid.parse(ctx.params.id);
  switch (ctx.params.action) {
    case "submit": {
      const { notes } = await ctx.json(submitSchema);
      return ctx.scope((s) => submitTimesheet(s, id, notes));
    }
    case "approve": {
      const { note } = await ctx.json(approveSchema);
      return ctx.scope((s) => approveTimesheet(s, id, note));
    }
    case "reject": {
      const { reason } = await ctx.json(reasonSchema);
      return ctx.scope((s) => rejectTimesheet(s, id, reason));
    }
    case "request-adjustment": {
      const { reason } = await ctx.json(reasonSchema);
      return ctx.scope((s) => requestAdjustment(s, id, reason));
    }
    case "adjust": {
      const input = await ctx.json(adjustSchema);
      return ctx.scope((s) => adjustTimesheet(s, id, input));
    }
    default:
      throw notFound("Unknown timesheet action");
  }
});
