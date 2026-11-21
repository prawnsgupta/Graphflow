import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { withRls } from "@/lib/db/context";
import { generateToken, hashToken } from "@/lib/auth/tokens";

/** Identity resolved from a valid session cookie. Never built from client input. */
export interface SessionUser {
  sessionId: string;
  userId: string;
  organizationId: string;
  role: UserRole;
  displayName: string;
  email: string;
  teamId: string | null;
  trackingConsent: boolean;
  expiresAt: Date;
  organization: { name: string; slug: string; timezone: string; isDemo: boolean };
}

interface SessionRow {
  session_id: string;
  user_id: string;
  organization_id: string;
  role: UserRole;
  display_name: string;
  email: string;
  team_id: string | null;
  tracking_consent: boolean;
  expires_at: Date;
  last_seen_at: Date;
  org_name: string;
  org_slug: string;
  org_timezone: string;
  org_is_demo: boolean;
}

export async function resolveSessionToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length > 200 || !token.startsWith("gfs_")) return null;
  const rows = await prisma.$queryRaw<SessionRow[]>`SELECT * FROM app_auth_session_lookup(${hashToken(token)})`;
  const r = rows[0];
  if (!r) return null;
  return {
    sessionId: r.session_id,
    userId: r.user_id,
    organizationId: r.organization_id,
    role: r.role,
    displayName: r.display_name,
    email: r.email,
    teamId: r.team_id,
    trackingConsent: r.tracking_consent,
    expiresAt: r.expires_at,
    organization: { name: r.org_name, slug: r.org_slug, timezone: r.org_timezone, isDemo: r.org_is_demo },
  };
}

export async function createSessionRecord(input: {
  userId: string;
  organizationId: string;
  role: UserRole;
  ttlHours: number;
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken("gfs");
  const expiresAt = new Date(Date.now() + input.ttlHours * 3600_000);
  await withRls({ userId: input.userId, organizationId: input.organizationId, role: input.role }, async (tx) => {
    await tx.authSession.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        tokenHash: hashToken(token),
        userAgent: input.userAgent?.slice(0, 300) ?? null,
        ipAddress: input.ipAddress?.slice(0, 64) ?? null,
        expiresAt,
      },
      select: { id: true },
    });
    await tx.user.update({ where: { id: input.userId }, data: { lastLoginAt: new Date() }, select: { id: true } });
  });
  return { token, expiresAt };
}

export async function revokeSession(user: SessionUser): Promise<void> {
  await withRls(user, async (tx) => {
    await tx.authSession.updateMany({ where: { id: user.sessionId }, data: { revokedAt: new Date() } });
  });
}
