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

interface ChannelValues {
  kind?: string | null;
  value?: string | null;
  href?: string | null;
}

/**
 * Se valida la fila que va a quedar guardada, no el payload.
 *
 * Un PUT es parcial, así que cada campo sale del payload si vino y de la fila
 * actual si no. Mirar sólo una de las dos puntas dejaba pasar combinaciones
 * inválidas en los dos sentidos:
 *
 * - cambiar `kind` y `value` juntos se validaba contra el `kind` **anterior**,
 *   así que un número de teléfono se guardaba como `email`;
 * - cambiar sólo el `kind` no miraba el `value` ya guardado, y la fila quedaba
 *   con un valor que no corresponde a su tipo.
 */
export function validateChannelValues(
  data: ChannelValues,
  ctx: z.RefinementCtx,
  current?: ChannelValues,
) {
  const kind = (data.kind ?? current?.kind) as ContactChannelKind | undefined;
  if (!kind) return;

  // `undefined` = el campo no vino en el payload y conserva lo guardado.
  const value = (data.value !== undefined ? data.value : current?.value)?.trim();
  const fromPayload = data.value !== undefined;
  if (value && !isValidChannelValue(kind, value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["value"],
      message: fromPayload
        ? `"${kind}": ${CHANNEL_VALUE_MESSAGE[kind]}`
        : `el valor ya guardado no corresponde a "${kind}": ${CHANNEL_VALUE_MESSAGE[kind]}. Cambiá el valor en la misma edición.`,
    });
  }

  const href = (data.href !== undefined ? data.href : current?.href)?.trim();
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
  // En el PUT se valida la fila resultante: payload + lo que ya estaba.
  refineUpdate: (data, current, ctx) => validateChannelValues(data, ctx, current),
  serialize: (row: any) => ({ ...row, active: Boolean(row.active) }),
});
