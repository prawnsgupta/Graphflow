import { route } from "@/lib/api/handler";
import { acceptInvitationSchema } from "@/lib/validation/forms";
import { acceptInvitation, lookupInvitation } from "@/services/auth/auth-service";
import { notFound } from "@/lib/api/errors";

export const GET = route<{ token: string }>(
  { auth: "none", rateLimit: { name: "invitation-lookup", limit: 30, windowSeconds: 300 } },
  async ({ params }) => {
    const inv = await lookupInvitation(params.token);
    if (!inv) throw notFound("This invitation is invalid, expired or already used");
    return { email: inv.email, displayName: inv.displayName, role: inv.role, organizationName: inv.organizationName };
  },
);

export const POST = route<{ token: string }>(
  { auth: "none", rateLimit: { name: "invitation-accept", limit: 10, windowSeconds: 900 } },
  async (ctx) => {
    const input = await ctx.json(acceptInvitationSchema);
    return acceptInvitation(ctx.params.token, input);
  },
);
