import { z } from "zod";

export const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
export const uuid = z.string().uuid();
export const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v && v !== "all" ? v : undefined))
  .pipe(z.string().uuid().optional());

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const analyticsQuery = z
  .object({
    from: dateKey.optional(),
    to: dateKey.optional(),
    projectId: optionalUuid,
    userId: optionalUuid,
    teamId: optionalUuid,
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "from must be before to" });

export type AnalyticsQuery = z.infer<typeof analyticsQuery>;

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
