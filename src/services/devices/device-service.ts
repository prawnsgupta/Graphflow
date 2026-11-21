import type { DbScope } from "@/lib/db/context";
import { writeAudit } from "@/services/audit/audit-writer";
import { generateToken, hashToken } from "@/lib/auth/tokens";
import { forbidden, notFound } from "@/lib/api/errors";

const deviceSelect = {
  id: true,
  name: true,
  platform: true,
  isSimulated: true,
  isActive: true,
  lastSeenAt: true,
  createdAt: true,
  userId: true,
  tokenHash: true,
} as const;

function present<T extends { tokenHash: string | null }>(d: T) {
  const { tokenHash, ...rest } = d;
  return { ...rest, hasToken: !!tokenHash };
}

async function canActFor(scope: DbScope, userId: string) {
  if (userId === scope.actor.userId) return true;
  const [{ allowed }] = await scope.tx.$queryRaw<{ allowed: boolean }[]>`SELECT app_can_manage_user(${userId}::uuid) AS allowed`;
  return allowed;
}

export async function listDevices(scope: DbScope, userId?: string) {
  const target = userId ?? scope.actor.userId;
  if (!(await canActFor(scope, target))) throw forbidden();
  const devices = await scope.tx.device.findMany({ where: { userId: target }, select: deviceSelect, orderBy: { createdAt: "asc" } });
  return devices.map(present);
}

export async function createDevice(scope: DbScope, input: { name: string; userId?: string; platform: string; isSimulated: boolean }) {
  const target = input.userId ?? scope.actor.userId;
  if (!(await canActFor(scope, target))) throw forbidden("You cannot register devices for this employee");
  const device = await scope.tx.device.create({
    data: { organizationId: scope.actor.organizationId, userId: target, name: input.name, platform: input.platform, isSimulated: input.isSimulated },
    select: deviceSelect,
  });
  await writeAudit(scope, { action: "device.registered", entityType: "Device", entityId: device.id, metadata: { userId: target, name: input.name, isSimulated: input.isSimulated } });
  return present(device);
}

/** Issue a bearer token for a future native collector. Shown exactly once. */
export async function issueDeviceToken(scope: DbScope, id: string) {
  const device = await scope.tx.device.findFirst({ where: { id }, select: { id: true, userId: true } });
  if (!device) throw notFound("Device not found");
  if (device.userId !== scope.actor.userId) throw forbidden("Only the device owner can issue its token");
  const token = generateToken("gfd");
  await scope.tx.device.update({ where: { id }, data: { tokenHash: hashToken(token) }, select: { id: true } });
  await writeAudit(scope, { action: "device.token_issued", entityType: "Device", entityId: id });
  return { token };
}

export async function setDeviceActive(scope: DbScope, id: string, isActive: boolean) {
  const device = await scope.tx.device.findFirst({ where: { id }, select: { id: true, userId: true } });
  if (!device) throw notFound("Device not found");
  if (!(await canActFor(scope, device.userId))) throw forbidden();
  const updated = await scope.tx.device.update({ where: { id }, data: { isActive, ...(isActive ? {} : { tokenHash: null }) }, select: deviceSelect });
  await writeAudit(scope, { action: isActive ? "device.activated" : "device.deactivated", entityType: "Device", entityId: id });
  return present(updated);
}
