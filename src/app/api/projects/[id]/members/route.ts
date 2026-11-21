import { route, json } from "@/lib/api/handler";
import { memberSchema } from "@/lib/validation/forms";
import { addMember, removeMember } from "@/services/projects/project-service";
import { uuid } from "@/lib/validation/common";

export const POST = route<{ id: string }>({ capability: "projects:manage" }, async (ctx) => {
  const input = await ctx.json(memberSchema);
  return json(await ctx.scope((s) => addMember(s, uuid.parse(ctx.params.id), input)), { status: 201 });
});

export const DELETE = route<{ id: string }>({ capability: "projects:manage" }, async (ctx) => {
  const userId = uuid.parse(ctx.req.nextUrl.searchParams.get("userId"));
  await ctx.scope((s) => removeMember(s, uuid.parse(ctx.params.id), userId));
  return { ok: true };
});
