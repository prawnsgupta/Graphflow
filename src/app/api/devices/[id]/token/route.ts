import { route } from "@/lib/api/handler";
import { issueDeviceToken } from "@/services/devices/device-service";
import { uuid } from "@/lib/validation/common";

export const POST = route<{ id: string }>(
  { rateLimit: { name: "device-token", limit: 10, windowSeconds: 3600, by: "user" } },
  (ctx) => ctx.scope((s) => issueDeviceToken(s, uuid.parse(ctx.params.id))),
);
