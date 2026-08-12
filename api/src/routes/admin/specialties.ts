import { crudRouter, iconSchema, z } from "./crud.js";

export const specialtiesRouter = crudRouter({
  table: "specialties",
  uniqueIcon: true,
  defaultOrderBy: "order",
  schema: z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
    icon: iconSchema,
    description: z.string().nullable().optional(),
    order: z.number().int().optional(),
  }),
});
