import { z } from "zod";
import { route } from "@/lib/api/handler";
import { analyticsQuery } from "@/lib/validation/common";
import { buildReport, reportToCsv, REPORT_TYPES, type ReportType } from "@/services/reports/report-service";
import { reportToPdf } from "@/services/reports/pdf";
import { writeAudit } from "@/services/audit/audit-writer";
import { notFound } from "@/lib/api/errors";

const formatSchema = z.enum(["json", "csv", "pdf"]).default("json");

export const GET = route<{ type: string }>(
  { capability: "reports:view", rateLimit: { name: "reports", limit: 60, windowSeconds: 60, by: "user" } },
  async (ctx) => {
    if (!REPORT_TYPES.some((r) => r.id === ctx.params.type)) throw notFound("Unknown report type");
    const type = ctx.params.type as ReportType;
    const format = formatSchema.parse(ctx.req.nextUrl.searchParams.get("format") ?? undefined);
    const q = ctx.query(analyticsQuery.innerType().extend({ format: z.string().optional() }));
    const report = await ctx.scope(async (s) => {
      const r = await buildReport(s, type, q);
      if (format !== "json") {
        await writeAudit(s, {
          action: "report.exported",
          entityType: "Report",
          entityId: type,
          projectId: q.projectId ?? null,
          metadata: { format, from: r.period.from, to: r.period.to, timezone: r.timezone, rows: r.rows.length },
        });
      }
      return r;
    });
    const filename = `graphflow-${type}-${report.period.from}-${report.period.to}`;
    if (format === "csv") {
      return new Response(reportToCsv(report), {
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}.csv"` },
      });
    }
    if (format === "pdf") {
      const bytes = await reportToPdf(report);
      return new Response(Buffer.from(bytes), {
        headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${filename}.pdf"` },
      });
    }
    return report;
  },
);
