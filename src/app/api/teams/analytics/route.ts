import { route } from "@/lib/api/handler";
import { analyticsQuery } from "@/lib/validation/common";
import { teamAnalytics } from "@/services/analytics/analytics-service";

export const GET = route({ capability: "teams:view" }, (ctx) => {
  const q = ctx.query(analyticsQuery);
  return ctx.scope((s) => teamAnalytics(s, q));
});
