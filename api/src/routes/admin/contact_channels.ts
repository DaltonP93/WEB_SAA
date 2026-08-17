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

/**
 * Los ocho canales institucionales, con el `kind` que les corresponde.
 *
 * No son "datos cargados": son parte del producto. El header lee `emergencias`
 * por su clave, el pie arma la lista excluyendo `emergencias` y `gth` por sus
 * claves, y varios bloques declaran `keys: ["whatsapp-estudios", …]`. Borrar
 * una fila o cambiarle la `key` no deja un hueco visible: deja el sitio
 * buscando una clave que ya no existe y mostrando "A confirmar" para siempre,
 * sin ningún error que lo delate.
 *
 * El `kind` está acá por lo mismo: define qué formato se valida y qué enlace se
 * genera. Pasar `emergencias` a `email` convertiría un `tel:` en un `mailto:`
 * roto en el botón de urgencias.
 *
 * Todo lo demás —label, value, note, message, href, icon, active, order— se
 * edita con normalidad, y los canales que el sanatorio cree después siguen
 * teniendo CRUD completo.
 */
export const RESERVED_CHANNELS: Record<string, ContactChannelKind> = {
  emergencias: "phone",
  "whatsapp-turnos": "whatsapp",
  "whatsapp-estudios": "whatsapp",
  "whatsapp-general": "whatsapp",
  "whatsapp-samap": "whatsapp",
  recepcion: "phone",
  "email-general": "email",
  gth: "email",
};

export const isReservedChannel = (key: unknown): key is string =>
  typeof key === "string" && Object.prototype.hasOwnProperty.call(RESERVED_CHANNELS, key);

export const contactChannelsRouter = crudRouter({
  table: "contact_channels",
  defaultOrderBy: "order",
  schema: baseSchema.superRefine((data, ctx) => validateChannelValues(data, ctx)),
  // En el PUT se valida la fila resultante: payload + lo que ya estaba.
  refineUpdate: (data, current, ctx) => validateChannelValues(data, ctx, current),
  serialize: (row: any) => ({ ...row, active: Boolean(row.active) }),
  guard: {
    canDelete: (row) =>
      isReservedChannel(row.key)
        ? `"${row.key}" es un canal institucional del sitio y no se puede eliminar. ` +
          "Si no querés que aparezca, desmarcá 'Activo' en vez de borrarlo."
        : null,
    canUpdate: (row, payload) => {
      if (!isReservedChannel(row.key)) return null;
      if (payload.key !== undefined && payload.key !== row.key) {
        return (
          `no se puede cambiar la clave de "${row.key}": el sitio la busca por ese nombre ` +
          "(encabezado, pie y varios bloques). Cambiala y esos lugares dejan de encontrarla."
        );
      }
      const esperado = RESERVED_CHANNELS[row.key];
      if (payload.kind !== undefined && payload.kind !== esperado) {
        return (
          `"${row.key}" tiene que seguir siendo de tipo "${esperado}": de ahí sale el formato ` +
          "que se valida y el tipo de enlace que se genera."
        );
      }
      return null;
    },
  },
});
