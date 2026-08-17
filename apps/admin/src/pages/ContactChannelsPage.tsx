import EntityManager from "../components/EntityManager";

/**
 * Qué canales son institucionales lo dice la API, no una lista de acá.
 *
 * Cada fila viene con `reserved` y `expectedKind` desde
 * `api/src/routes/admin/contact_channels.ts`. Mantener una segunda copia de las
 * ocho claves en el panel era garantía de deriva: agregar un canal
 * institucional en la API y olvidarlo acá haría que el panel ofreciera un botón
 * "Eliminar" que la API rechaza con 403.
 */
const motivoProteccion = (row: any): string | null => {
  if (!row?.reserved) return null;
  if (row.expectedKind && row.kind !== row.expectedKind) {
    return (
      `Canal institucional del sitio. Su tipo debería ser "${row.expectedKind}" y hoy está como ` +
      `"${row.kind}": corregilo en este mismo formulario. La clave no se cambia y la fila no se elimina.`
    );
  }
  return "Es un canal institucional del sitio: la clave y el tipo no se cambian, y no se puede eliminar. Para ocultarlo, desmarcá Activo.";
};

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
      protectedRow={motivoProteccion}
      // El tipo se desbloquea justo cuando está mal: es el camino de reparación.
      lockedFields={(row) => (row?.reserved && row.kind !== row.expectedKind ? ["key"] : ["key", "kind"])}
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
