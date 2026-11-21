import { route } from "@/lib/api/handler";
import { updateEmployeeSchema } from "@/lib/validation/forms";
import { getEmployee, updateEmployee } from "@/services/employees/employee-service";
import { uuid } from "@/lib/validation/common";

export const GET = route<{ id: string }>({}, (ctx) => ctx.scope((s) => getEmployee(s, uuid.parse(ctx.params.id))));

export const PATCH = route<{ id: string }>({ capability: "employees:manage" }, async (ctx) => {
  const input = await ctx.json(updateEmployeeSchema);
  return ctx.scope((s) => updateEmployee(s, uuid.parse(ctx.params.id), input));
});
