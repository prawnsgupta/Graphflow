import { route, json } from "@/lib/api/handler";
import { revokeSession } from "@/services/auth/session-store";
import { withRls } from "@/lib/db/context";
import { writeAuditRaw } from "@/services/audit/audit-writer";

const COOKIE = process.env.NODE_ENV === "production" ? "__Host-gf_session" : "gf_session";

export const POST = route({ auth: "optional" }, async (ctx) => {
  if (ctx.user) {
    await revokeSession(ctx.user);
    await withRls(ctx.user, (tx) =>
      writeAuditRaw(tx, {
        organizationId: ctx.user!.organizationId,
        actorId: ctx.user!.userId,
        action: "auth.logout",
        entityType: "User",
        entityId: ctx.user!.userId,
        requestId: ctx.requestId,
      }),
    );
  }
  const res = json({ ok: true });
  res.cookies.set(COOKIE, "", { httpOnly: true, path: "/", expires: new Date(0), sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return res;
});
