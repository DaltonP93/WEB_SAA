import { crudRouter, z } from "./crud.js";

export const schedulesRouter = crudRouter({
  table: "schedules",
  defaultOrderBy: "order",
  // Una edición del panel tiene que mover la marca de tiempo. Sin esto,
  // `updated_at` conservaba para siempre el valor que le puso la migración que
  // creó la fila, y quien usara esa marca para saber si alguien la tocó —el
  // blindaje del rollback de la nota de la guardia— leía un dato inmóvil.
  touchUpdatedAt: true,
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
