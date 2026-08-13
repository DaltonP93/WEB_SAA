import { crudRouter, iconSchema, z } from "./crud.js";
import {
  CHANNEL_VALUE_MESSAGE,
  isValidChannelUrl,
  isValidChannelValue,
  type ContactChannelKind,
} from "../../contact-values.js";

/**
 * Canales de contacto.
 *
 * `value` y `href` se validan contra el `kind` del canal: un `kind: "url"`
 * termina en `<a href>` del sitio público, así que aceptar cualquier string
 * era aceptar `javascript:` en un enlace que ve cualquier visitante. Los
 * teléfonos y correos se validan por lo mismo en menor grado: un valor mal
 * formado genera un `tel:`/`mailto:` roto.
 *
 * El vacío sigue siendo válido: los canales arrancan sin dato y la UI los
 * muestra como "A confirmar" hasta que el sanatorio los cargue.
 */
const baseSchema = z.object({
  key: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, "sólo minúsculas, números y guiones"),
  label: z.string().min(1).max(191),
  kind: z.enum(["whatsapp", "phone", "email", "url"]),
  value: z.string().max(191).nullable().optional(),
  note: z.string().max(255).nullable().optional(),
  message: z.string().max(500).nullable().optional(),
  href: z.string().max(500).nullable().optional(),
  icon: iconSchema,
  active: z.boolean().optional(),
  order: z.number().int().optional(),
});

/**
 * En un PUT parcial el `kind` puede no venir en el payload. Sin él no se sabe
 * contra qué validar, así que el router lo completa con el de la fila actual
 * antes de llamar acá.
 */
export function validateChannelValues(
  data: { kind?: string; value?: string | null; href?: string | null },
  ctx: z.RefinementCtx,
  kindOverride?: string,
) {
  const kind = (kindOverride ?? data.kind) as ContactChannelKind | undefined;
  if (!kind) return;

  const value = data.value?.trim();
  if (value && !isValidChannelValue(kind, value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["value"],
      message: `"${kind}": ${CHANNEL_VALUE_MESSAGE[kind]}`,
    });
  }

  const href = data.href?.trim();
  if (href && !isValidChannelUrl(href)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["href"],
      message: `el enlace ${CHANNEL_VALUE_MESSAGE.url}`,
    });
  }
}

export const contactChannelsRouter = crudRouter({
  table: "contact_channels",
  defaultOrderBy: "order",
  schema: baseSchema.superRefine((data, ctx) => validateChannelValues(data, ctx)),
  // En el PUT parcial falta `kind`: se toma el de la fila guardada.
  refineUpdate: (data, current, ctx) => validateChannelValues(data, ctx, current?.kind),
  serialize: (row: any) => ({ ...row, active: Boolean(row.active) }),
});
