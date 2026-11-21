import { route } from "@/lib/api/handler";
import { optionalUuid } from "@/lib/validation/common";
import { billingSummary } from "@/services/billing/timesheet-service";

export const GET = route({ capability: "billing:view" }, (ctx) => {
  const projectId = optionalUuid.parse(ctx.req.nextUrl.searchParams.get("projectId") ?? undefined);
  return ctx.scope((s) => billingSummary(s, { projectId }));
});
