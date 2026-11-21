import { PrismaClient } from "@prisma/client";

/**
 * Prisma client bound to DATABASE_URL — the restricted `graphflow_app` role.
 * Row-Level Security always applies to this connection. All tenant queries
 * must run through `withRls` / `withSystem` (see ./context.ts) so that the
 * transaction-scoped request context is set.
 */
const globalForPrisma = globalThis as unknown as { __graphflowPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.__graphflowPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : process.env.NODE_ENV === "test" ? [] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.__graphflowPrisma = prisma;
