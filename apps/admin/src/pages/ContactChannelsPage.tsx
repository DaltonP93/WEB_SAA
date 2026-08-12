import EntityManager from "../components/EntityManager";

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
