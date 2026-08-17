import EntityManager from "../components/EntityManager";

/**
 * Los ocho canales institucionales. Coincide con `RESERVED_CHANNELS` de la API,
 * que es quien manda: acá sólo se evita ofrecer un botón que va a devolver 403.
 */
const RESERVADOS = new Set([
  "emergencias",
  "whatsapp-turnos",
  "whatsapp-estudios",
  "whatsapp-general",
  "whatsapp-samap",
  "recepcion",
  "email-general",
  "gth",
]);

/**
 * Canales de contacto: fuente única de WhatsApp, teléfonos y correos.
 * Lo que se carga acá alimenta el encabezado, el pie, Turnos, Contacto y
 * cualquier bloque de canales. Un canal sin valor se publica como
 * "A confirmar", sin generar enlaces inválidos.
 */
export default function ContactChannelsPage() {
  return (
    <EntityManager
      title="Canales de contacto"
      endpoint="/admin/contact-channels"
      cacheKey="adm-contact-channels"
      reorderable
      labelKey="label"
      subtitleKey="value"
      withSlug={false}
      // `active` tiene default 1 en la base: un canal nuevo nace visible.
      createDefaults={{ active: true }}
      protectedRow={(row) =>
        RESERVADOS.has(row.key)
          ? "Es un canal institucional del sitio: la clave y el tipo no se cambian, y no se puede eliminar. Para ocultarlo, desmarcá Activo."
          : null
      }
      lockedFields={["key", "kind"]}
      fields={[
        { key: "label", label: "Nombre visible" },
        { key: "key", label: "Clave (no cambiar si ya se usa)" },
        { key: "kind", label: "Tipo", kind: "select", options: [
          { value: "whatsapp", label: "WhatsApp" },
          { value: "phone", label: "Teléfono" },
          { value: "email", label: "Correo" },
          { value: "url", label: "Enlace" },
        ] },
        { key: "value", label: "Número / correo (vacío = A confirmar)" },
        { key: "note", label: "Descripción", kind: "textarea" },
        { key: "message", label: "Mensaje pre-cargado (sólo WhatsApp)", kind: "textarea" },
        { key: "href", label: "Enlace directo (sólo tipo Enlace)" },
        { key: "icon", label: "Icono", kind: "icon" },
        { key: "active", label: "Activo", kind: "checkbox" },
      ]}
    />
  );
}
