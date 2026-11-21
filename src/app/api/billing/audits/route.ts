import { z } from "zod";
import { route, json } from "@/lib/api/handler";
import { dateKey, optionalUuid, paginationQuery } from "@/lib/validation/common";
import { listBillableAudits, runBillableAudits } from "@/services/billing/billable-audit-service";

export const GET = route({ capability: "billing:audit" }, (ctx) => {
  const q = ctx.query(paginationQuery.extend({ projectId: optionalUuid }));
  return ctx.scope((s) => listBillableAudits(s, q));
});

export const POST = route({ capability: "billing:audit" }, async (ctx) => {
  const input = await ctx.json(
    z.object({ from: dateKey, to: dateKey, projectId: z.string().uuid().optional() }).refine((v) => v.from <= v.to, "from must be before to"),
  );
  return json(await ctx.scope((s) => runBillableAudits(s, input)), { status: 201 });
});
