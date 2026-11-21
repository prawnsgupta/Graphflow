import { route } from "@/lib/api/handler";
import { teamSchema } from "@/lib/validation/forms";
import { deleteTeam, updateTeam } from "@/services/teams/team-service";
import { uuid } from "@/lib/validation/common";

export const PATCH = route<{ id: string }>({ capability: "teams:manage" }, async (ctx) => {
  const input = await ctx.json(teamSchema.partial());
  return ctx.scope((s) => updateTeam(s, uuid.parse(ctx.params.id), input));
});

export const DELETE = route<{ id: string }>({ capability: "teams:manage" }, async (ctx) => {
  await ctx.scope((s) => deleteTeam(s, uuid.parse(ctx.params.id)));
  return { ok: true };
});
