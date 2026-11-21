import { route } from "@/lib/api/handler";
import { changePasswordSchema } from "@/lib/validation/forms";
import { changePassword } from "@/services/auth/auth-service";

export const POST = route(
  { rateLimit: { name: "change-password", limit: 10, windowSeconds: 900, by: "user" } },
  async (ctx) => {
    const { currentPassword, newPassword } = await ctx.json(changePasswordSchema);
    await ctx.scope((s) => changePassword(s, currentPassword, newPassword));
    return { ok: true };
  },
);
