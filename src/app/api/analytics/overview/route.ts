import { route } from "@/lib/api/handler";
import { analyticsQuery } from "@/lib/validation/common";
import { overview } from "@/services/analytics/analytics-service";

export const GET = route({}, (ctx) => {
  const q = ctx.query(analyticsQuery);
  return ctx.scope((s) => overview(s, q));
});
