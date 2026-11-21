import { route } from "@/lib/api/handler";
import { deleteDraftTimesheet, getTimesheet } from "@/services/billing/timesheet-service";
import { uuid } from "@/lib/validation/common";

export const GET = route<{ id: string }>({ capability: "billing:view" }, (ctx) =>
  ctx.scope((s) => getTimesheet(s, uuid.parse(ctx.params.id))),
);

export const DELETE = route<{ id: string }>({ capability: "billing:view" }, async (ctx) => {
  await ctx.scope((s) => deleteDraftTimesheet(s, uuid.parse(ctx.params.id)));
  return { ok: true };
});
