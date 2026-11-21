import type { Prisma, PrismaClient, UserRole } from "@prisma/client";
import { prisma } from "./prisma";

export type Tx = Prisma.TransactionClient;

/** The identity a database transaction runs as. Derived only from the server-side session. */
export interface Actor {
  userId: string;
  organizationId: string;
  role: UserRole;
  teamId?: string | null;
}

/** Context role values understood by the RLS policies. */
export type ContextRole = UserRole | "SYSTEM";

export interface DbScope {
  tx: Tx;
  actor: Actor;
  requestId?: string;
}

interface TxOptions {
  timeoutMs?: number;
  client?: PrismaClient;
}

async function setContext(tx: Tx, userId: string | null, organizationId: string, role: ContextRole) {
  // Transaction-scoped (is_local = true): context disappears at COMMIT/ROLLBACK,
  // so pooled connections can never leak identity between requests.
  await tx.$queryRaw`SELECT
    set_config('app.user_id', ${userId ?? ""}, true),
    set_config('app.organization_id', ${organizationId}, true),
    set_config('app.user_role', ${role}, true)`;
}

/**
 * Run `fn` inside a transaction whose RLS context is the given user.
 * Every scoped query in `fn` must use the provided `tx`.
 */
export async function withRls<T>(actor: Actor, fn: (tx: Tx) => Promise<T>, opts: TxOptions = {}): Promise<T> {
  const client = opts.client ?? prisma;
  return client.$transaction(
    async (tx) => {
      await setContext(tx, actor.userId, actor.organizationId, actor.role);
      return fn(tx);
    },
    { timeout: opts.timeoutMs ?? 20_000, maxWait: 10_000 },
  );
}

/**
 * Run `fn` as the SYSTEM context for one organization (background worker,
 * token flows after verification). Still tenant-scoped by RLS.
 */
export async function withSystem<T>(
  organizationId: string,
  fn: (tx: Tx) => Promise<T>,
  opts: TxOptions & { userId?: string | null } = {},
): Promise<T> {
  const client = opts.client ?? prisma;
  return client.$transaction(
    async (tx) => {
      await setContext(tx, opts.userId ?? null, organizationId, "SYSTEM");
      return fn(tx);
    },
    { timeout: opts.timeoutMs ?? 30_000, maxWait: 10_000 },
  );
}

/**
 * Temporarily switch the CURRENT transaction to the SYSTEM context for a
 * narrowly-scoped, already-authorized step (e.g. auto-approval), then
 * restore the user's context. Avoids opening a second transaction that would
 * wait on row locks held by this one.
 */
export async function elevateToSystem<T>(scope: DbScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  await scope.tx.$queryRaw`SELECT set_config('app.user_role', 'SYSTEM', true)`;
  try {
    return await fn(scope.tx);
  } finally {
    await scope.tx.$queryRaw`SELECT set_config('app.user_role', ${scope.actor.role}, true)`;
  }
}

/** Build a scope helper for service calls. */
export function scoped<T>(actor: Actor, requestId: string | undefined, fn: (scope: DbScope) => Promise<T>) {
  return withRls(actor, (tx) => fn({ tx, actor, requestId }));
}

export const ADMIN_ROLES: readonly UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN"];
export const isAdminRole = (role: UserRole | ContextRole) =>
  role === "SUPER_ADMIN" || role === "ORG_ADMIN" || role === "SYSTEM";
