import type { BlockType } from "@sa/shared/blocks";

/**
 * Editor de props simplificado: genera inputs basados en un schema declarado
 * por tipo de bloque. Para casos simples (texto, número, select, array).
 */

interface FieldDef {
  key: string;
  label: string;
  kind: "text" | "textarea" | "number" | "select" | "color" | "image" | "url" | "json" | "items" | "checkbox";
  options?: { label: string; value: any }[];
  itemFields?: FieldDef[]; // para 'items'
}

const SCHEMAS: Record<BlockType, FieldDef[]> = {
  hero: [
    { key: "title", label: "Título", kind: "text" },
    { key: "subtitle", label: "Subtítulo", kind: "text" },
    { key: "imageUrl", label: "Imagen URL", kind: "image" },
    { key: "ctaLabel", label: "CTA Label", kind: "text" },
    { key: "ctaHref", label: "CTA Href", kind: "url" },
    { key: "variant", label: "Variante", kind: "select", options: [{ label: "Centrado", value: "centered" }, { label: "Izquierda", value: "left" }, { label: "Split", value: "split" }] },
    { key: "overlay", label: "Overlay %", kind: "number" },
  ],
  richText: [{ key: "html", label: "HTML", kind: "textarea" }],
  cards: [
    { key: "heading", label: "Encabezado", kind: "text" },
    { key: "columns", label: "Columnas", kind: "select", options: [{ label: "2", value: 2 }, { label: "3", value: 3 }, { label: "4", value: 4 }] },
    { key: "items", label: "Tarjetas", kind: "items", itemFields: [
      { key: "title", label: "Título", kind: "text" },
      { key: "text", label: "Texto", kind: "textarea" },
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
    { key: "showSearch", label: "Mostrar buscador", kind: "checkbox" },
    { key: "limit", label: "Límite", kind: "number" },
  ],
  specialtyGrid: [
    { key: "columns", label: "Columnas", kind: "select", options: [3,4,6].map(n => ({ label: String(n), value: n })) },
    { key: "showCount", label: "Cantidad a mostrar", kind: "number" },
  ],
  serviceGrid: [
    { key: "columns", label: "Columnas", kind: "select", options: [2,3,4].map(n => ({ label: String(n), value: n })) },
    { key: "showCount", label: "Cantidad a mostrar", kind: "number" },
  ],
  studyGrid: [
    { key: "columns", label: "Columnas", kind: "select", options: [2,3,4].map(n => ({ label: String(n), value: n })) },
    { key: "showCount", label: "Cantidad a mostrar", kind: "number" },
    { key: "grouped", label: "Agrupar por categoría (lista completa)", kind: "checkbox" },
  ],
  newsGrid: [
    { key: "limit", label: "Cantidad", kind: "number" },
    { key: "columns", label: "Columnas", kind: "select", options: [2,3,4].map(n => ({ label: String(n), value: n })) },
  ],
  mapEmbed: [
    { key: "embedHtml", label: "HTML del iframe", kind: "textarea" },
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
  cta: [
    { key: "title", label: "Título", kind: "text" },
    { key: "text", label: "Texto", kind: "text" },
    { key: "ctaLabel", label: "Label del botón", kind: "text" },
    { key: "ctaHref", label: "Href", kind: "url" },
    { key: "background", label: "Color/Background", kind: "color" },
  ],
  stats: [
    { key: "items", label: "Items", kind: "items", itemFields: [
      { key: "value", label: "Valor", kind: "text" },
      { key: "label", label: "Etiqueta", kind: "text" },
    ]},
  ],
  logos: [
    { key: "heading", label: "Encabezado", kind: "text" },
    { key: "logos", label: "Logos", kind: "items", itemFields: [
      { key: "imageUrl", label: "Imagen", kind: "image" },
      { key: "alt", label: "Alt", kind: "text" },
      { key: "href", label: "Enlace", kind: "url" },
    ]},
  ],
  spacer: [{ key: "height", label: "Alto (px)", kind: "number" }],
};

function Field({ def, value, onChange }: { def: FieldDef; value: any; onChange: (v: any) => void }) {
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
  if (def.kind === "items") {
    const arr: any[] = Array.isArray(value) ? value : [];
    return (
      <div className="space-y-2">
        {arr.map((item, idx) => (
          <div key={idx} className="border rounded p-3 bg-gray-50">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-gray-500">Item #{idx + 1}</span>
              <button type="button" onClick={() => onChange(arr.filter((_, i) => i !== idx))} className="text-red-600 text-xs">Quitar</button>
            </div>
            {def.itemFields?.map((f) => (
              <div key={f.key} className="mb-2">
                <label className="label">{f.label}</label>
                <Field def={f} value={item[f.key]} onChange={(v) => {
                  const next = [...arr];
                  next[idx] = { ...item, [f.key]: v };
                  onChange(next);
                }} />
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
        </div>
      ))}
    </div>
  );
}
