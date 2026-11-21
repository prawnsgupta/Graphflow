import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveSessionToken, type SessionUser } from "@/services/auth/session-store";
import { can, type Capability } from "@/lib/permissions";

export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-gf_session" : "gf_session";

/** Resolve the current user from the HTTP-only session cookie (cached per request). */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  return resolveSessionToken(store.get(SESSION_COOKIE)?.value);
});

/** For server components/pages: redirect to login when unauthenticated. */
export async function requirePageSession(capability?: Capability): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (capability && !can(session.role, capability)) redirect("/dashboard?denied=1");
  return session;
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}
