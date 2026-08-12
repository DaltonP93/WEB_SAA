import { crudRouter, z } from "./crud.js";

export const studiesRouter = crudRouter({
  table: "studies",
  defaultOrderBy: "order",
  schema: z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
    category: z.enum(["laboratorio", "imagenes", "cardiologicos", "biopsias"]).nullable().optional(),
    icon: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    body: z.string().nullable().optional(),
    order: z.number().int().optional(),
  }),
});
