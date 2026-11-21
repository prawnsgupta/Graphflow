import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { withRls, withSystem, type DbScope } from "@/lib/db/context";
import { burnPasswordCheck, hashPassword, verifyPassword } from "@/lib/auth/password";
import { generateToken, hashToken } from "@/lib/auth/tokens";
import { createSessionRecord } from "./session-store";
import { writeAudit, writeAuditRaw } from "@/services/audit/audit-writer";
import { AppError, badRequest, unauthorized } from "@/lib/api/errors";

interface LookupRow {
  id: string;
  organization_id: string;
  role: UserRole;
  password_hash: string | null;
  is_active: boolean;
}

export async function login(input: {
  email: string;
  password: string;
  ttlHours: number;
  userAgent?: string | null;
  ipAddress?: string | null;
  requestId?: string;
}) {
  const rows = await prisma.$queryRaw<LookupRow[]>`SELECT * FROM app_auth_lookup_user(${input.email})`;
  const user = rows[0];
  if (!user) {
    await burnPasswordCheck(input.password); // equalise timing
    throw unauthorized("Invalid email or password");
  }
  const ok = await verifyPassword(user.password_hash, input.password);
  if (!ok || !user.is_active) {
    await withSystem(user.organization_id, (tx) =>
      writeAuditRaw(tx, {
        organizationId: user.organization_id,
        actorId: null,
        action: "auth.login_failed",
        entityType: "User",
        entityId: user.id,
        metadata: { reason: ok ? "inactive" : "bad_password", ip: input.ipAddress ?? null },
        requestId: input.requestId,
      }),
    );
    throw unauthorized(ok ? "This account is deactivated" : "Invalid email or password");
  }
  const session = await createSessionRecord({
    userId: user.id,
    organizationId: user.organization_id,
    role: user.role,
    ttlHours: input.ttlHours,
    userAgent: input.userAgent,
    ipAddress: input.ipAddress,
  });
  await withRls({ userId: user.id, organizationId: user.organization_id, role: user.role }, (tx) =>
    writeAuditRaw(tx, {
      organizationId: user.organization_id,
      actorId: user.id,
      action: "auth.login",
      entityType: "User",
      entityId: user.id,
      metadata: { ip: input.ipAddress ?? null },
      requestId: input.requestId,
    }),
  );
  return session;
}

/**
 * Password reset. Always responds identically whether or not the email
 * exists. Email delivery is not configured in this build: the reset link is
 * written to the server log (development) — see docs/SECURITY.md.
 */
export async function requestPasswordReset(email: string, appUrl: string): Promise<void> {
  const rows = await prisma.$queryRaw<LookupRow[]>`SELECT * FROM app_auth_lookup_user(${email})`;
  const user = rows[0];
  if (!user || !user.is_active) return;
  const token = generateToken("gfr");
  await withSystem(user.organization_id, async (tx) => {
    await tx.passwordResetToken.create({
      data: {
        organizationId: user.organization_id,
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
    await writeAuditRaw(tx, {
      organizationId: user.organization_id,
      actorId: null,
      action: "auth.password_reset_requested",
      entityType: "User",
      entityId: user.id,
    });
  });
  console.info(`[auth] Password reset link for ${email}: ${appUrl}/reset-password?token=${token}`);
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const rows = await prisma.$queryRaw<
    { id: string; user_id: string; organization_id: string; expires_at: Date; used_at: Date | null }[]
  >`SELECT * FROM app_lookup_reset_token(${hashToken(token)})`;
  const t = rows[0];
  if (!t || t.used_at || t.expires_at < new Date()) throw badRequest("This reset link is invalid or has expired");
  const hash = await hashPassword(newPassword);
  await withSystem(t.organization_id, async (tx) => {
    const used = await tx.passwordResetToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) throw badRequest("This reset link has already been used");
    await tx.user.update({ where: { id: t.user_id }, data: { passwordHash: hash }, select: { id: true } });
    // Revoke every existing session after a password reset.
    await tx.authSession.updateMany({ where: { userId: t.user_id, revokedAt: null }, data: { revokedAt: new Date() } });
    await writeAuditRaw(tx, {
      organizationId: t.organization_id,
      actorId: null,
      action: "auth.password_reset",
      entityType: "User",
      entityId: t.user_id,
    });
  });
}

export async function changePassword(scope: DbScope, currentPassword: string, newPassword: string) {
  const me = await scope.tx.user.findUniqueOrThrow({ where: { id: scope.actor.userId }, select: { email: true } });
  const rows = await prisma.$queryRaw<LookupRow[]>`SELECT * FROM app_auth_lookup_user(${me.email})`;
  const hash = rows[0]?.password_hash ?? null;
  if (!(await verifyPassword(hash, currentPassword))) throw new AppError(400, "INVALID_PASSWORD", "Current password is incorrect");
  await scope.tx.user.update({
    where: { id: scope.actor.userId },
    data: { passwordHash: await hashPassword(newPassword) },
    select: { id: true },
  });
  await writeAudit(scope, { action: "auth.password_changed", entityType: "User", entityId: scope.actor.userId });
}

interface InvitationRow {
  id: string;
  organization_id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  team_id: string | null;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  org_name: string;
}

export async function lookupInvitation(token: string) {
  const rows = await prisma.$queryRaw<InvitationRow[]>`SELECT * FROM app_lookup_invitation(${hashToken(token)})`;
  const inv = rows[0];
  if (!inv || inv.accepted_at || inv.revoked_at || inv.expires_at < new Date()) return null;
  return { email: inv.email, displayName: inv.display_name, role: inv.role, organizationName: inv.org_name, row: inv };
}

export async function acceptInvitation(token: string, input: { displayName: string; password: string; trackingConsent: boolean }) {
  const inv = await lookupInvitation(token);
  if (!inv) throw badRequest("This invitation is invalid, expired or already used");
  const hash = await hashPassword(input.password);
  const row = inv.row;
  return withSystem(row.organization_id, async (tx) => {
    const marked = await tx.invitation.updateMany({ where: { id: row.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
    if (marked.count !== 1) throw badRequest("This invitation has already been used");
    const user = await tx.user.create({
      data: {
        organizationId: row.organization_id,
        email: row.email,
        displayName: input.displayName,
        passwordHash: hash,
        role: row.role,
        teamId: row.team_id,
        trackingConsent: input.trackingConsent,
        consentUpdatedAt: new Date(),
      },
      select: { id: true },
    });
    await tx.device.create({
      data: { organizationId: row.organization_id, userId: user.id, name: "Simulated Workstation", platform: "web-simulator", isSimulated: true },
    });
    await writeAuditRaw(tx, {
      organizationId: row.organization_id,
      actorId: null,
      action: "user.invitation_accepted",
      entityType: "User",
      entityId: user.id,
      metadata: { email: row.email, role: row.role, trackingConsent: input.trackingConsent },
    });
    return { userId: user.id };
  });
}
