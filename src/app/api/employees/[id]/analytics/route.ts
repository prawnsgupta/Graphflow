import { route } from "@/lib/api/handler";
import { analyticsQuery, uuid } from "@/lib/validation/common";
import { employeeAnalytics } from "@/services/analytics/analytics-service";
import { getEmployee } from "@/services/employees/employee-service";

export const GET = route<{ id: string }>({}, (ctx) => {
  const id = uuid.parse(ctx.params.id);
  const q = ctx.query(analyticsQuery);
  return ctx.scope(async (s) => {
    await getEmployee(s, id); // directory visibility check
    return employeeAnalytics(s, id, q);
  });
});
