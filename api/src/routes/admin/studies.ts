import { crudRouter, z } from "./crud.js";

export const studiesRouter = crudRouter({
  table: "studies",
  defaultOrderBy: "order",
  serialize: (row: any) => ({ ...row, published: Boolean(row.published) }),
  schema: z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
    category: z.enum(["laboratorio", "imagenes", "cardiologicos", "biopsias"]).nullable().optional(),
    icon: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    body: z.string().nullable().optional(),
    published: z.boolean().optional(),
    order: z.number().int().optional(),
  }),
});
