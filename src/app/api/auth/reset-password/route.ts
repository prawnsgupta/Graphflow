import { route } from "@/lib/api/handler";
import { resetPasswordSchema } from "@/lib/validation/forms";
import { resetPassword } from "@/services/auth/auth-service";

export const POST = route(
  { auth: "none", rateLimit: { name: "reset-password", limit: 10, windowSeconds: 900 } },
  async (ctx) => {
    const { token, password } = await ctx.json(resetPasswordSchema);
    await resetPassword(token, password);
    return { ok: true };
  },
);
