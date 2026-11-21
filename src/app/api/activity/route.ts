import { z } from "zod";
import { route } from "@/lib/api/handler";
import { dateKey, optionalUuid, paginationQuery } from "@/lib/validation/common";
import { listActivity } from "@/services/activity/activity-service";
import { localRangeToUtc } from "@/lib/utils/time";

const query = paginationQuery.extend({
  from: dateKey.optional(),
  to: dateKey.optional(),
  userId: optionalUuid,
  projectId: optionalUuid,
  toolId: optionalUuid,
  category: z.enum(["DEEP_FOCUS", "ACTIVE_WORK", "COLLABORATION", "ADMINISTRATIVE", "IDLE", "UNASSIGNED"]).optional().or(z.literal("").transform(() => undefined)),
  billable: z.enum(["true", "false", ""]).optional().transform((v) => (v === "true" ? true : v === "false" ? false : undefined)),
});

export const GET = route({ capability: "activity:view" }, (ctx) => {
  const q = ctx.query(query);
  return ctx.scope(async (s) => {
    const org = await s.tx.organization.findUniqueOrThrow({ where: { id: s.actor.organizationId }, select: { timezone: true } });
    const range = q.from || q.to ? localRangeToUtc(q.from ?? "2000-01-01", q.to ?? "2999-12-31", org.timezone) : null;
    return listActivity(s, { ...q, start: range?.start, end: range?.end });
  });
});
