import { route } from "@/lib/api/handler";
import { projectUpdateSchema } from "@/lib/validation/forms";
import { deleteProject, getProject, updateProject } from "@/services/projects/project-service";
import { uuid } from "@/lib/validation/common";

export const GET = route<{ id: string }>({ capability: "projects:view" }, (ctx) =>
  ctx.scope((s) => getProject(s, uuid.parse(ctx.params.id))),
);

export const PATCH = route<{ id: string }>({ capability: "projects:manage" }, async (ctx) => {
  const input = await ctx.json(projectUpdateSchema);
  return ctx.scope((s) => updateProject(s, uuid.parse(ctx.params.id), input));
});

export const DELETE = route<{ id: string }>({ capability: "projects:manage" }, async (ctx) => {
  await ctx.scope((s) => deleteProject(s, uuid.parse(ctx.params.id)));
  return { ok: true };
});
