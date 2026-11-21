import { route } from "@/lib/api/handler";
import { revokeInvitation } from "@/services/employees/employee-service";
import { uuid } from "@/lib/validation/common";

export const DELETE = route<{ id: string }>({ capability: "employees:manage" }, async (ctx) => {
  await ctx.scope((s) => revokeInvitation(s, uuid.parse(ctx.params.id)));
  return { ok: true };
});
