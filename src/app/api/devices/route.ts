import { route, json } from "@/lib/api/handler";
import { deviceSchema } from "@/lib/validation/forms";
import { createDevice, listDevices } from "@/services/devices/device-service";
import { optionalUuid } from "@/lib/validation/common";

export const GET = route({}, (ctx) => {
  const userId = optionalUuid.parse(ctx.req.nextUrl.searchParams.get("userId") ?? undefined);
  return ctx.scope((s) => listDevices(s, userId));
});

export const POST = route({}, async (ctx) => {
  const input = await ctx.json(deviceSchema);
  return json(await ctx.scope((s) => createDevice(s, input)), { status: 201 });
});
