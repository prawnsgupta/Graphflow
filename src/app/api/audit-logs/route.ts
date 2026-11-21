import { z } from "zod";
import { route } from "@/lib/api/handler";
import { dateKey, optionalUuid, paginationQuery } from "@/lib/validation/common";
import { listAuditLogs } from "@/services/audit/audit-service";
import { localRangeToUtc } from "@/lib/utils/time";

const query = paginationQuery.extend({
  action: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(60).optional(),
  actorId: optionalUuid,
  projectId: optionalUuid,
  from: dateKey.optional(),
  to: dateKey.optional(),
});

export const GET = route({ capability: "audit:view" }, (ctx) => {
  const q = ctx.query(query);
  return ctx.scope(async (s) => {
    const org = await s.tx.organization.findUniqueOrThrow({ where: { id: s.actor.organizationId }, select: { timezone: true } });
    const range = q.from || q.to ? localRangeToUtc(q.from ?? "2000-01-01", q.to ?? "2999-12-31", org.timezone) : null;
    return listAuditLogs(s, { ...q, entityType: q.entityType || undefined, from: range?.start, to: range?.end });
  });
});
