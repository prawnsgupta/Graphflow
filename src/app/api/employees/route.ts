import { z } from "zod";
import { route, json } from "@/lib/api/handler";
import { inviteSchema } from "@/lib/validation/forms";
import { optionalUuid, paginationQuery } from "@/lib/validation/common";
import { inviteEmployee, listEmployees } from "@/services/employees/employee-service";
import { env } from "@/config/env";

const query = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  teamId: optionalUuid,
  role: z.enum(["SUPER_ADMIN", "ORG_ADMIN", "PROJECT_MANAGER", "TEAM_LEAD", "EMPLOYEE"]).optional().or(z.literal("").transform(() => undefined)),
  status: z.enum(["active", "inactive", "all"]).default("active"),
});

export const GET = route({ capability: "employees:view" }, (ctx) => {
  const q = ctx.query(query);
  return ctx.scope((s) => listEmployees(s, q));
});

export const POST = route({ capability: "employees:manage" }, async (ctx) => {
  const input = await ctx.json(inviteSchema);
  const invitation = await ctx.scope((s) => inviteEmployee(s, input, env().APP_URL));
  return json(invitation, { status: 201 });
});
