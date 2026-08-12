import { crudRouter, z } from "./crud.js";

export const schedulesRouter = crudRouter({
  table: "schedules",
  defaultOrderBy: "order",
  schema: z.object({
    key: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, "sólo minúsculas, números y guiones"),
    area: z.string().min(1).max(191),
    service_slug: z.string().max(191).nullable().optional(),
    days: z.string().max(191).nullable().optional(),
    hours: z.string().max(191).nullable().optional(),
    note: z.string().max(255).nullable().optional(),
    active: z.boolean().optional(),
    order: z.number().int().optional(),
  }),
  serialize: (row: any) => ({ ...row, active: Boolean(row.active) }),
});
