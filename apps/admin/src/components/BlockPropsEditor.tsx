import { useQuery } from "@tanstack/react-query";
import type { BlockType } from "@sa/shared/blocks";
import { api } from "../api";
import IconPicker from "./IconPicker";
import MediaPicker, { type MediaSeleccionada } from "./MediaPicker";

/**
 * Editor de props simplificado: genera inputs basados en un schema declarado
 * por tipo de bloque. Para casos simples (texto, número, select, array).
 */

interface FieldDef {
  key: string;
  label: string;
  kind:
    | "text"
    | "textarea"
    | "number"
    | "select"
    | "color"
    | "image"
    | "url"
    | "json"
    | "items"
    | "checkbox"
    | "icon"
    | "channelKeys";
  options?: { label: string; value: any }[];
  itemFields?: FieldDef[]; // para 'items'
  /** Aclaración corta debajo del campo (reglas que además valida el servidor). */
  help?: string;
}

const SCHEMAS: Record<BlockType, FieldDef[]> = {
  hero: [
    { key: "title", label: "Título", kind: "text" },
    { key: "eyebrow", label: "Eyebrow (etiqueta superior)", kind: "text" },
    { key: "subtitle", label: "Subtítulo", kind: "text" },
    { key: "imageUrl", label: "Imagen URL", kind: "image" },
    { key: "ctaLabel", label: "CTA principal Label", kind: "text" },
    { key: "ctaHref", label: "CTA principal Href", kind: "url" },
    { key: "secondaryCtaLabel", label: "CTA secundario Label", kind: "text" },
    { key: "secondaryCtaHref", label: "CTA secundario Href", kind: "url" },
    { key: "variant", label: "Variante", kind: "select", options: [{ label: "Centrado", value: "centered" }, { label: "Izquierda", value: "left" }, { label: "Split", value: "split" }] },
    { key: "overlay", label: "Overlay %", kind: "number" },
    { key: "animatedBg", label: "Fondo con gradiente animado", kind: "checkbox" },
  ],
  richText: [{ key: "html", label: "HTML", kind: "textarea" }],
  cards: [
    { key: "heading", label: "Encabezado", kind: "text" },
    { key: "columns", label: "Columnas", kind: "select", options: [{ label: "2", value: 2 }, { label: "3", value: 3 }, { label: "4", value: 4 }] },
    { key: "items", label: "Tarjetas", kind: "items", itemFields: [
      { key: "title", label: "Título", kind: "text" },
      { key: "text", label: "Texto", kind: "textarea" },
      { key: "icon", label: "Icono", kind: "icon" },
      { key: "imageUrl", label: "Imagen", kind: "image" },
      { key: "href", label: "Enlace", kind: "url" },
    ]},
  ],
  accordion: [
    { key: "heading", label: "Encabezado", kind: "text" },
    { key: "items", label: "Items", kind: "items", itemFields: [
      { key: "title", label: "Título", kind: "text" },
      { key: "body", label: "Cuerpo (HTML)", kind: "textarea" },
    ]},
  ],
  slider: [
    { key: "autoplayMs", label: "Autoplay (ms)", kind: "number" },
    { key: "slides", label: "Slides", kind: "items", itemFields: [
      { key: "imageUrl", label: "Imagen", kind: "image" },
      { key: "title", label: "Título", kind: "text" },
      { key: "text", label: "Texto", kind: "text" },
      { key: "href", label: "Enlace", kind: "url" },
    ]},
  ],
  gallery: [
    { key: "columns", label: "Columnas", kind: "select", options: [2,3,4,5].map(n => ({ label: String(n), value: n })) },
    { key: "images", label: "Imágenes", kind: "items", itemFields: [
      { key: "url", label: "URL", kind: "image" },
      { key: "alt", label: "Alt", kind: "text" },
    ]},
  ],
  doctorList: [
    { key: "heading", label: "Encabezado", kind: "text" },
    { key: "intro", label: "Texto introductorio", kind: "textarea" },
    { key: "showSearch", label: "Mostrar filtros (especialidad / médico / nombre)", kind: "checkbox" },
    { key: "specialtySlug", label: "Especialidad fija (slug, ej: odontologia)", kind: "text" },
    { key: "lockSpecialty", label: "Bloquear especialidad (sólo esos médicos)", kind: "checkbox" },
    { key: "specialtyFilter", label: "Especialidad preseleccionada (id, opcional)", kind: "number" },
    { key: "limit", label: "Límite", kind: "number" },
    { key: "emptyText", label: "Texto cuando no hay profesionales", kind: "textarea" },
  ],
  specialtyGrid: [
    { key: "heading", label: "Encabezado", kind: "text" },
    { key: "columns", label: "Columnas", kind: "select", options: [3,4,6].map(n => ({ label: String(n), value: n })) },
    { key: "showCount", label: "Cantidad a mostrar", kind: "number" },
    { key: "compact", label: "Vista compacta (chips)", kind: "checkbox" },
  ],
  serviceGrid: [
    { key: "heading", label: "Encabezado", kind: "text" },
    { key: "columns", label: "Columnas", kind: "select", options: [2,3,4].map(n => ({ label: String(n), value: n })) },
    { key: "showCount", label: "Cantidad a mostrar", kind: "number" },
    { key: "compact", label: "Vista compacta", kind: "checkbox" },
  ],
  studyGrid: [
    { key: "heading", label: "Encabezado", kind: "text" },
    { key: "columns", label: "Columnas", kind: "select", options: [2,3,4].map(n => ({ label: String(n), value: n })) },
    { key: "showCount", label: "Cantidad a mostrar", kind: "number" },
    { key: "grouped", label: "Agrupar por categoría (lista completa)", kind: "checkbox" },
    { key: "category", label: "Solo una categoría", kind: "select", options: [
      { label: "Laboratorio", value: "laboratorio" },
      { label: "Estudios por imágenes", value: "imagenes" },
      { label: "Estudios cardiológicos", value: "cardiologicos" },
      { label: "Biopsias / anatomía patológica", value: "biopsias" },
    ] },
  ],
  mapEmbed: [
    { key: "heading", label: "Encabezado", kind: "text" },
    { key: "text", label: "Texto (dirección, referencias)", kind: "textarea" },
    { key: "embedHtml", label: "Mapa de Google", kind: "textarea",
      help: "Pegá el iframe que da Google Maps (Compartir → Insertar un mapa) o la URL sola. Se guarda sólo la URL: el sitio arma el mapa por su cuenta." },
    { key: "directionsUrl", label: "Link \"Cómo llegar\"", kind: "url" },
    { key: "height", label: "Alto (px)", kind: "number" },
  ],
  videoEmbed: [
    { key: "url", label: "URL (YouTube/Vimeo)", kind: "url" },
    { key: "caption", label: "Pie", kind: "text" },
  ],
  contactForm: [
    { key: "heading", label: "Encabezado", kind: "text" },
    { key: "showPhone", label: "Mostrar teléfono", kind: "checkbox" },
  ],
  appointmentForm: [
    { key: "heading", label: "Encabezado", kind: "text" },
    { key: "defaultSpecialtyId", label: "Especialidad por defecto (id)", kind: "number" },
  ],
  newsletter: [
    { key: "heading", label: "Encabezado", kind: "text" },
    { key: "text", label: "Texto", kind: "textarea" },
    { key: "buttonLabel", label: "Texto del botón", kind: "text" },
  ],
  contactChannels: [
    { key: "heading", label: "Encabezado", kind: "text" },
    { key: "text", label: "Texto", kind: "textarea" },
    { key: "columns", label: "Columnas", kind: "select", options: [2,3,4].map(n => ({ label: String(n), value: n })) },
    { key: "keys", label: "Canales a mostrar", kind: "channelKeys" },
  ],
  socialLinks: [
    { key: "heading", label: "Encabezado", kind: "text" },
    { key: "text", label: "Texto", kind: "textarea" },
    { key: "muted", label: "Fondo gris", kind: "checkbox" },
  ],
  steps: [
    { key: "heading", label: "Encabezado", kind: "text" },
    { key: "text", label: "Texto introductorio", kind: "textarea" },
    { key: "muted", label: "Fondo gris", kind: "checkbox" },
    { key: "items", label: "Pasos", kind: "items", itemFields: [
      { key: "title", label: "Título del paso", kind: "text" },
      { key: "text", label: "Detalle", kind: "textarea" },
      { key: "icon", label: "Icono", kind: "icon" },
    ]},
  ],
  scheduleTable: [
    { key: "heading", label: "Encabezado", kind: "text" },
    { key: "text", label: "Texto", kind: "textarea" },
  ],
  cta: [
    { key: "title", label: "Título", kind: "text" },
    { key: "text", label: "Texto", kind: "text" },
    { key: "ctaLabel", label: "Label del botón", kind: "text" },
    { key: "ctaHref", label: "Href", kind: "url" },
    { key: "variant", label: "Variante", kind: "select", options: [
      { label: "Primario (default)", value: "primary" },
      { label: "Secundario", value: "secondary" },
      { label: "Suave", value: "muted" },
      { label: "Emergencias (rojo)", value: "emergency" },
    ], help: "El rojo es exclusivo de Emergencias: sólo se guarda si el CTA apunta a /emergencias y su texto lo dice." },
  ],
  stats: [
    { key: "heading", label: "Encabezado", kind: "text" },
    { key: "items", label: "Items", kind: "items", itemFields: [
      { key: "value", label: "Valor", kind: "text" },
      { key: "label", label: "Etiqueta", kind: "text" },
      { key: "icon", label: "Icono", kind: "icon" },
    ]},
  ],
  logos: [
    { key: "heading", label: "Encabezado", kind: "text" },
    {
      key: "opacity",
      label: "Opacidad de la fila (%)",
      kind: "number",
      help: "Entre 20 y 100. Sin valor se usa 80, que es como se veía antes.",
    },
    { key: "logos", label: "Logos", kind: "items", itemFields: [
      // `imageUrl` es de tipo `image`: al elegir de Multimedia completa además
      // el alt, el ancho y el alto del ítem. Ver `rellenoDesdeMedia`.
      { key: "imageUrl", label: "Imagen", kind: "image" },
      { key: "alt", label: "Texto alternativo", kind: "text", help: "Sin alt, un logo enlazado no se publica como enlace: un lector de pantalla no podría decir a dónde lleva." },
      { key: "href", label: "Enlace", kind: "url" },
      { key: "active", label: "Mostrar en el sitio", kind: "checkbox" },
      { key: "width", label: "Ancho (px)", kind: "number" },
      { key: "height", label: "Alto (px)", kind: "number" },
    ]},
  ],
  spacer: [{ key: "height", label: "Alto (px)", kind: "number" }],
};

/**
 * Selector de canales de contacto. Los datos viven en Configuración → Canales
 * de contacto; acá sólo se elige cuáles muestra el bloque (vacío = todos).
 */
function ChannelKeysField({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const q = useQuery({
    queryKey: ["adm-contact-channels"],
    queryFn: async () => (await api.get("/admin/contact-channels")).data as any[],
  });
  const selected: string[] = Array.isArray(value) ? value : [];
  const channels = q.data ?? [];

  function toggle(key: string) {
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  }

  if (q.isLoading) return <p className="text-sm text-gray-500">Cargando canales…</p>;
  if (channels.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No hay canales cargados todavía. Creálos en <strong>Canales de contacto</strong>.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">
        Sin selección se muestran todos los canales activos, en su orden.
      </p>
      <div className="grid gap-1 sm:grid-cols-2">
        {channels.map((c) => (
          <label key={c.key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={selected.includes(c.key)} onChange={() => toggle(c.key)} />
            <span>
              {c.label}
              <span className="text-gray-400"> · {c.kind}</span>
              {!c.value && <span className="text-amber-600"> · a confirmar</span>}
              {!c.active && <span className="text-gray-400"> · inactivo</span>}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * Mueve un elemento de `arr` de `desde` a `hacia`.
 *
 * Devuelve un array nuevo: React compara por identidad, y mutar el original
 * haría que la lista no se volviera a dibujar. Los objetos **no** se copian —
 * se mueven las mismas referencias— así que un ítem conserva todo lo que
 * tenga adentro, incluidos los campos que este editor no conoce.
 */
export function mover<T>(arr: T[], desde: number, hacia: number): T[] {
  if (desde === hacia || desde < 0 || hacia < 0 || desde >= arr.length || hacia >= arr.length) return arr;
  const copia = [...arr];
  const [item] = copia.splice(desde, 1);
  copia.splice(hacia, 0, item);
  return copia;
}

/**
 * Qué campos completa una imagen elegida desde Multimedia.
 *
 * El alt sólo se rellena si está vacío: si alguien escribió el suyo, elegir
 * otra imagen no debería pisárselo. Las dimensiones sí se reemplazan siempre —
 * las del archivo anterior serían directamente falsas para el nuevo.
 */
function rellenoDesdeMedia(
  item: Record<string, unknown>,
  campos: FieldDef[],
  media: MediaSeleccionada,
): Record<string, unknown> {
  const tiene = (k: string) => campos.some((c) => c.key === k);
  const siguiente: Record<string, unknown> = { ...item };

  if (tiene("alt") && !String(item.alt ?? "").trim() && media.alt) siguiente.alt = media.alt;
  if (tiene("width") && media.width) siguiente.width = media.width;
  if (tiene("height") && media.height) siguiente.height = media.height;

  return siguiente;
}

function Field({ def, value, onChange, taken }: { def: FieldDef; value: any; onChange: (v: any) => void; taken?: string[] }) {
  if (def.kind === "channelKeys") return <ChannelKeysField value={value} onChange={onChange} />;
  if (def.kind === "image") return <MediaPicker value={value ?? ""} onChange={onChange} label={def.label} />;
  if (def.kind === "icon") return <IconPicker value={value} onChange={(v) => onChange(v ?? "")} taken={taken} />;
  if (def.kind === "textarea") return <textarea className="input" rows={4} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  if (def.kind === "number") return <input type="number" className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />;
  if (def.kind === "checkbox") return (
    <label className="inline-flex min-h-10 items-center gap-2 text-sm">
      <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
      <span>Activado</span>
    </label>
  );
  if (def.kind === "color") return <input type="color" className="h-10 w-20 border rounded" value={value ?? "#000000"} onChange={(e) => onChange(e.target.value)} />;
  if (def.kind === "select") return (
    <select className="input" value={value ?? ""} onChange={(e) => onChange(def.options?.find((o) => String(o.value) === e.target.value)?.value)}>
      <option value="">—</option>
      {def.options?.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
    </select>
  );
  /**
   * Lista de ítems, con orden.
   *
   * El reordenamiento vive **acá** y no dentro de un bloque concreto: el orden
   * de un array `kind: "items"` es el orden en que se publica, y hasta ahora la
   * única forma de cambiarlo era borrar los ítems de abajo y volver a
   * escribirlos. Eso afecta por igual a tarjetas, acordeón, slider, galería,
   * pasos, estadísticas y logos, y lo va a afectar a cualquier bloque futuro
   * que declare un campo de este tipo, sin código propio.
   *
   * Subir/Bajar y no arrastrar: dos botones funcionan con teclado, con lector
   * de pantalla y en un teléfono, sin necesitar una alternativa aparte.
   */
  if (def.kind === "items") {
    const arr: any[] = Array.isArray(value) ? value : [];
    const etiqueta = def.label.toLowerCase();

    return (
      <div className="space-y-2">
        {arr.map((item, idx) => (
          <div key={idx} className="border rounded p-3 bg-gray-50">
            <div className="flex justify-between items-center mb-2 gap-2">
              <span className="text-xs text-gray-500">Item #{idx + 1}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onChange(mover(arr, idx, idx - 1))}
                  // El primero no tiene a dónde subir. Deshabilitado y no
                  // oculto: un botón que aparece y desaparece mueve el resto
                  // de los controles bajo el cursor.
                  disabled={idx === 0}
                  aria-label={`Subir ${etiqueta} ${idx + 1}`}
                  className="text-xs text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed"
                >
                  ↑ Subir
                </button>
                <button
                  type="button"
                  onClick={() => onChange(mover(arr, idx, idx + 1))}
                  disabled={idx === arr.length - 1}
                  aria-label={`Bajar ${etiqueta} ${idx + 1}`}
                  className="text-xs text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed"
                >
                  ↓ Bajar
                </button>
                <button
                  type="button"
                  onClick={() => onChange(arr.filter((_, i) => i !== idx))}
                  aria-label={`Quitar ${etiqueta} ${idx + 1}`}
                  className="text-red-600 text-xs"
                >
                  Quitar
                </button>
              </div>
            </div>
            {def.itemFields?.map((f) => (
              <div key={f.key} className="mb-2">
                <label className="label" htmlFor={`item-${def.key}-${idx}-${f.key}`}>{f.label}</label>
                {f.kind === "image" ? (
                  <MediaPicker
                    id={`item-${def.key}-${idx}-${f.key}`}
                    label={f.label}
                    value={item[f.key] ?? ""}
                    onChange={(v) => {
                      const next = [...arr];
                      next[idx] = { ...item, [f.key]: v };
                      onChange(next);
                    }}
                    // Elegir de la biblioteca completa además el alt y las
                    // dimensiones, si el ítem tiene esos campos. Pegar una URL
                    // a mano no puede traerlas, y sin ellas el sitio salta al
                    // cargar cada imagen.
                    onPick={(media) => {
                      const next = [...arr];
                      next[idx] = rellenoDesdeMedia(
                        { ...item, [f.key]: media.url },
                        def.itemFields ?? [],
                        media,
                      );
                      onChange(next);
                    }}
                  />
                ) : (
                  <Field
                    def={f}
                    value={item[f.key]}
                    // Dos ítems de la misma grilla no pueden repetir icono: la
                    // API lo rechaza, así que se marcan ocupados en el selector.
                    taken={
                      f.kind === "icon"
                        ? arr.filter((_, i) => i !== idx).map((o) => o?.[f.key]).filter(Boolean)
                        : undefined
                    }
                    onChange={(v) => {
                      const next = [...arr];
                      next[idx] = { ...item, [f.key]: v };
                      onChange(next);
                    }}
                  />
                )}
                {f.help && <p className="text-xs text-gray-500 mt-1">{f.help}</p>}
              </div>
            ))}
          </div>
        ))}
        <button type="button" onClick={() => onChange([...arr, {}])} className="btn-secondary text-xs">Agregar item</button>
      </div>
    );
  }
  return <input className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
}

export default function BlockPropsEditor({ type, props, onChange }: { type: BlockType; props: any; onChange: (p: any) => void }) {
  const schema = SCHEMAS[type] ?? [];
  return (
    <div className="space-y-3">
      {schema.map((f) => (
        <div key={f.key}>
          <label className="label">{f.label}</label>
          <Field def={f} value={props?.[f.key]} onChange={(v) => onChange({ ...props, [f.key]: v })} />
          {f.help && <p className="mt-1 text-xs text-gray-500">{f.help}</p>}
        </div>
      ))}
    </div>
  );
}
