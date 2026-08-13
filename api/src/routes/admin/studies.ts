import { crudRouter, iconSchema, z } from "./crud.js";

export const studiesRouter = crudRouter({
  table: "studies",
  uniqueIcon: true,
  defaultOrderBy: "order",
  serialize: (row: any) => ({ ...row, published: Boolean(row.published) }),
  schema: z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
    category: z.enum(["laboratorio", "imagenes", "cardiologicos", "biopsias"]).nullable().optional(),
    icon: iconSchema,
    description: z.string().nullable().optional(),
    body: z.string().nullable().optional(),
    published: z.boolean().optional(),
    order: z.number().int().optional(),
  }),
});
