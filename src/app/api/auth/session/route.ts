import { route } from "@/lib/api/handler";
import { navFor } from "@/lib/permissions";

export const GET = route({ auth: "optional" }, async ({ user }) => {
  if (!user) return { authenticated: false };
  return {
    authenticated: true,
    user: {
      id: user.userId,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      teamId: user.teamId,
      trackingConsent: user.trackingConsent,
      organization: user.organization,
    },
    navigation: navFor(user.role),
    expiresAt: user.expiresAt,
  };
});
