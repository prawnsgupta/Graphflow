import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { hashToken } from "@/lib/auth/tokens";

export interface DeviceIdentity {
  deviceId: string;
  userId: string;
  organizationId: string;
  role: UserRole;
}

/** Resolve a device bearer token (for a future native desktop collector). */
export async function resolveDeviceToken(token: string): Promise<DeviceIdentity | null> {
  if (!token.startsWith("gfd_") || token.length > 200) return null;
  const rows = await prisma.$queryRaw<
    { device_id: string; user_id: string; organization_id: string; role: UserRole }[]
  >`SELECT * FROM app_device_token_lookup(${hashToken(token)})`;
  const r = rows[0];
  return r ? { deviceId: r.device_id, userId: r.user_id, organizationId: r.organization_id, role: r.role } : null;
}
