import { route, json } from "@/lib/api/handler";
import { generateTimesheetsSchema } from "@/lib/validation/forms";
import { generateTimesheets } from "@/services/billing/timesheet-service";

export const POST = route({ capability: "billing:view" }, async (ctx) => {
  const input = await ctx.json(generateTimesheetsSchema);
  return json(await ctx.scope((s) => generateTimesheets(s, input)), { status: 201 });
});
