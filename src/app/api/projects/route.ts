import { z } from "zod";
import { route, json } from "@/lib/api/handler";
import { projectSchema } from "@/lib/validation/forms";
import { optionalUuid, paginationQuery } from "@/lib/validation/common";
import { createProject, listProjects } from "@/services/projects/project-service";

const query = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"]).optional().or(z.literal("").transform(() => undefined)),
  teamId: optionalUuid,
});

export const GET = route({ capability: "projects:view" }, (ctx) => {
  const q = ctx.query(query);
  return ctx.scope((s) => listProjects(s, q));
});

export const POST = route({ capability: "projects:create" }, async (ctx) => {
  const input = await ctx.json(projectSchema);
  return json(await ctx.scope((s) => createProject(s, input)), { status: 201 });
});
