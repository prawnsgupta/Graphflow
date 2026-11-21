import { route } from "@/lib/api/handler";
import { analyticsQuery } from "@/lib/validation/common";
import { overview } from "@/services/analytics/analytics-service";

export const GET = route({}, (ctx) => {
  const q = ctx.query(analyticsQuery);
  return ctx.scope(async (s) => (await overview(s, q)).insights);
});
