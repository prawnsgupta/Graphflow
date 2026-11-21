import { route } from "@/lib/api/handler";
import { buildReport, reportToCsv } from "@/services/reports/report-service";
import { analyticsQuery } from "@/lib/validation/common";

/** CSV export of timesheets visible to the caller (same RLS scope as the Billing page). */
export const GET = route({ capability: "billing:view" }, async (ctx) => {
  const q = ctx.query(analyticsQuery);
  const report = await ctx.scope((s) => buildReport(s, "employee-timesheet", { from: q.from ?? "2000-01-01", to: q.to, projectId: q.projectId, userId: q.userId }));
  return new Response(reportToCsv(report), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="graphflow-timesheets-${report.period.from}-${report.period.to}.csv"`,
    },
  });
});
