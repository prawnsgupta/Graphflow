import { z } from "zod";
import { route } from "@/lib/api/handler";
import { setDeviceActive } from "@/services/devices/device-service";
import { uuid } from "@/lib/validation/common";

export const PATCH = route<{ id: string }>({}, async (ctx) => {
  const { isActive } = await ctx.json(z.object({ isActive: z.boolean() }));
  return ctx.scope((s) => setDeviceActive(s, uuid.parse(ctx.params.id), isActive));
});
