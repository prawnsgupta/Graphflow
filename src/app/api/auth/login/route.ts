import { route, json } from "@/lib/api/handler";
import { loginSchema } from "@/lib/validation/forms";
import { login } from "@/services/auth/auth-service";
import { rateLimit } from "@/lib/api/rate-limit";
import { tooManyRequests } from "@/lib/api/errors";
import { env } from "@/config/env";

const COOKIE = process.env.NODE_ENV === "production" ? "__Host-gf_session" : "gf_session";

export const POST = route({ auth: "none" }, async (ctx) => {
  const input = await ctx.json(loginSchema);
  // Brute-force protection: per IP + account (tight) and per IP (looser),
  // so one client cannot lock out every account behind a shared IP.
  const perAccount = await rateLimit(`login:${ctx.ip}:${input.email}`, 10, 300);
  const perIp = await rateLimit(`login-ip:${ctx.ip}`, 60, 300);
  if (!perAccount.allowed || !perIp.allowed) throw tooManyRequests("Too many sign-in attempts. Try again in a few minutes.");

  const session = await login({
    ...input,
    ttlHours: env().SESSION_TTL_HOURS,
    userAgent: ctx.req.headers.get("user-agent"),
    ipAddress: ctx.ip,
    requestId: ctx.requestId,
  });
  const res = json({ ok: true, expiresAt: session.expiresAt });
  res.cookies.set(COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
  return res;
});
