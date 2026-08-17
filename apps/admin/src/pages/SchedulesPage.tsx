import EntityManager from "../components/EntityManager";

/**
 * Horarios de atención. Cada fila es un área o tipo de atención con sus días
 * y su horario. Sólo se publican las filas activas y con horario cargado:
 * mientras no haya ninguna, el sitio muestra "Horarios en proceso de
 * confirmación" en vez de datos de ejemplo.
 */
export default function SchedulesPage() {
  return (
    <EntityManager
      title="Horarios de atención"
      endpoint="/admin/schedules"
      cacheKey="adm-schedules"
      reorderable
      labelKey="area"
      subtitleKey="hours"
      withSlug={false}
      // La columna `active` tiene default 0 en la base. Sin declararlo acá el
      // formulario mostraba el checkbox marcado, el payload no mandaba el
      // campo y la fila se creaba despublicada: la pantalla decía una cosa y
      // la base guardaba otra.
      createDefaults={{ active: false }}
      fields={[
        { key: "area", label: "Área o tipo de atención" },
        { key: "key", label: "Clave (no cambiar si ya se usa)" },
        { key: "days", label: "Días (ej: Lunes a viernes)" },
        { key: "hours", label: "Horario (ej: 07:00 a 19:00). Vacío = no se publica" },
        { key: "service_slug", label: "Slug del servicio relacionado (opcional)" },
        { key: "note", label: "Nota", kind: "textarea" },
        { key: "active", label: "Publicar", kind: "checkbox" },
      ]}
    />
  );
}
