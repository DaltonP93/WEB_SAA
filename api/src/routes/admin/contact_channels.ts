import { crudRouter, z } from "./crud.js";

export const contactChannelsRouter = crudRouter({
  table: "contact_channels",
  defaultOrderBy: "order",
  schema: z.object({
    key: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, "sólo minúsculas, números y guiones"),
    label: z.string().min(1).max(191),
    kind: z.enum(["whatsapp", "phone", "email", "url"]),
    value: z.string().max(191).nullable().optional(),
    note: z.string().max(255).nullable().optional(),
    message: z.string().max(500).nullable().optional(),
    href: z.string().max(500).nullable().optional(),
    icon: z.string().max(64).nullable().optional(),
    active: z.boolean().optional(),
    order: z.number().int().optional(),
  }),
  serialize: (row: any) => ({ ...row, active: Boolean(row.active) }),
});
