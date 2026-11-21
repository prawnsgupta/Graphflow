import { route } from "@/lib/api/handler";
import { REPORT_TYPES } from "@/services/reports/report-service";
import { can } from "@/lib/permissions";

export const GET = route({ capability: "reports:view" }, async ({ user }) =>
  REPORT_TYPES.filter((r) => r.id !== "organization-monthly" || can(user!.role, "reports:organization")),
);
