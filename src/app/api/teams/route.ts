import { route, json } from "@/lib/api/handler";
import { teamSchema } from "@/lib/validation/forms";
import { createTeam, listTeams } from "@/services/teams/team-service";

export const GET = route({}, (ctx) => ctx.scope((s) => listTeams(s)));

export const POST = route({ capability: "teams:manage" }, async (ctx) => {
  const input = await ctx.json(teamSchema);
  return json(await ctx.scope((s) => createTeam(s, input)), { status: 201 });
});
