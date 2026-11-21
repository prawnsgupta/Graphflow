import { route } from "@/lib/api/handler";
import { forgotPasswordSchema } from "@/lib/validation/forms";
import { requestPasswordReset } from "@/services/auth/auth-service";
import { env } from "@/config/env";

export const POST = route(
  { auth: "none", rateLimit: { name: "forgot-password", limit: 5, windowSeconds: 900 } },
  async (ctx) => {
    const { email } = await ctx.json(forgotPasswordSchema);
    await requestPasswordReset(email, env().APP_URL);
    // Identical response whether or not the account exists.
    return { ok: true, message: "If an account exists for that email, a reset link has been issued." };
  },
);
