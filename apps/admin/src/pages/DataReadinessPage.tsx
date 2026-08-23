import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import ConfirmacionDato, { type Confirmacion } from "../components/ConfirmacionDato";

/**
 * Datos pendientes: qué falta para que el sitio deje de decir "a confirmar".
 *
 * La pantalla **no muestra ningún dato del sanatorio**: ni teléfonos, ni
 * correos, ni horarios, ni notas. Sólo nombres de fila, estados, cantidades y
 * el enlace a la pantalla donde se resuelve cada caso. El endpoint tampoco los
 * manda, así que no hay nada que filtrar acá — pero la regla vale igual para lo
 * que se agregue después.
 *
 * **La única excepción es el alcance confirmado**, y es deliberada: una
 * constancia que no dice qué se confirmó no sirve de constancia. No es
 * contenido de una página, es el texto de la afirmación institucional, y lo
 * escribe la misma persona que lo lee acá.
 *
 * Todos los estados los calcula el servidor. Si esta pantalla los recalculara,
 * dos lugares tendrían que estar de acuerdo sobre qué cuenta como resuelto, y
 * dejarían de estarlo en la primera ronda que toque uno solo de los dos.
 */

type Estado = "complete" | "pending" | "review";

interface Item {
  key: string;
  label: string;
  status: string;
  expectedKind?: string;
}

interface Seccion {
  id: string;
  label: string;
  status: Estado;
  route: string;
  items?: Item[];
  complete?: number;
  publishable?: number;
  total?: number;
  reason?: string;
  pageSlug?: string;
  /** Presente en las secciones que se resuelven con una confirmación escrita. */
  confirmation?: Confirmacion | null;
  /** `false` cuando todavía no hay nada que confirmar (falta la página). */
  confirmable?: boolean;
}

interface Aviso {
  code: string;
  severity: "warning" | "info";
  route: string;
  message: string;
}

export interface Readiness {
  overall: Estado;
  summary: { resolved: number; pending: number; review: number; total: number };
  sections: Seccion[];
  warnings: Aviso[];
}

/** Los tres estados se distinguen por color **y** por texto, no sólo por color. */
const SECCION: Record<Estado, { texto: string; chip: string }> = {
  complete: { texto: "Completo", chip: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  pending: { texto: "Falta cargar", chip: "bg-amber-100 text-amber-900 border-amber-200" },
  review: { texto: "Requiere revisión", chip: "bg-red-100 text-red-800 border-red-200" },
};

/**
 * Qué le pasa a cada fila, en castellano y sin jerga.
 *
 * El `status` que viaja es estable y en inglés para que el panel pueda ramificar
 * sin depender del texto; lo que se lee en pantalla se traduce acá.
 */
const ITEM: Record<string, { texto: string; tono: Estado }> = {
  complete: { texto: "Cargado", tono: "complete" },
  empty: { texto: "Falta el dato", tono: "pending" },
  inactive: { texto: "Cargado, sin publicar", tono: "complete" },
  missing: { texto: "No existe la fila", tono: "review" },
  wrong_kind: { texto: "Tipo incorrecto", tono: "review" },
  invalid: { texto: "El dato cargado no sirve", tono: "review" },
};

/** El canal inactivo sí es pendiente: viene activo de fábrica. */
const ITEM_CANAL: Record<string, { texto: string; tono: Estado }> = {
  ...ITEM,
  inactive: { texto: "Desactivado", tono: "pending" },
};

const PUNTO: Record<Estado, string> = {
  complete: "bg-emerald-500",
  pending: "bg-amber-500",
  review: "bg-red-500",
};

function Chip({ estado }: { estado: Estado }) {
  const s = SECCION[estado];
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${s.chip}`}>{s.texto}</span>;
}

function ListaItems({ items, seccion, ruta }: { items: Item[]; seccion: string; ruta: string }) {
  const tabla = seccion === "contact-channels" ? ITEM_CANAL : ITEM;
  return (
    <ul className="divide-y divide-gray-100">
      {items.map((i) => {
        const estado = tabla[i.status] ?? { texto: i.status, tono: "review" as Estado };
        return (
          <li key={i.key} className="flex items-center gap-3 py-2 text-sm">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${PUNTO[estado.tono]}`} aria-hidden />
            <span className="font-medium truncate">{i.label}</span>
            <span className="ml-auto text-xs text-gray-500 whitespace-nowrap">{estado.texto}</span>
            {estado.tono !== "complete" && (
              <Link to={ruta} className="text-xs text-brand hover:underline whitespace-nowrap">
                Resolver
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function DataReadinessPage() {
  const q = useQuery<Readiness>({
    queryKey: ["adm-data-readiness"],
    queryFn: async () => (await api.get("/admin/data-readiness")).data,
  });

  if (q.isLoading) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Datos pendientes</h1>
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card p-5">
              <div className="h-5 w-48 bg-gray-200 rounded animate-pulse" />
              <div className="h-3 w-64 bg-gray-100 rounded animate-pulse mt-3" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Datos pendientes</h1>
        <div className="card p-5 border-red-200 bg-red-50">
          <p className="text-sm text-red-800 font-medium">No se pudo consultar el estado de los datos.</p>
          <p className="text-sm text-red-700 mt-1">
            Revisá que la API esté respondiendo y volvé a intentar.
          </p>
          <button onClick={() => q.refetch()} className="btn-secondary mt-3">
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const { summary, sections, warnings, overall } = q.data;

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-2xl font-bold">Datos pendientes</h1>
        <Chip estado={overall} />
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Qué falta cargar para que el sitio deje de mostrar “a confirmar”. Esta pantalla no muestra
        los datos: sólo dice cuáles están y cuáles no.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Resueltos", valor: summary.resolved, clase: "text-emerald-700" },
          { label: "Faltan cargar", valor: summary.pending, clase: "text-amber-700" },
          { label: "Requieren revisión", valor: summary.review, clase: "text-red-700" },
          { label: "Total", valor: summary.total, clase: "text-brand" },
        ].map((s) => (
          <div key={s.label} className="card p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">{s.label}</div>
            <div className={`text-3xl font-bold tabular-nums ${s.clase}`}>{s.valor}</div>
          </div>
        ))}
      </div>

      {warnings.length > 0 && (
        <div className="card p-5 mb-6">
          <h2 className="text-sm font-semibold mb-3">Avisos</h2>
          <ul className="space-y-2">
            {warnings.map((w, idx) => (
              <li key={`${w.code}-${idx}`} className="flex items-start gap-3 text-sm">
                <span
                  className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${
                    w.severity === "warning" ? "bg-amber-500" : "bg-gray-400"
                  }`}
                  aria-hidden
                />
                <span className="flex-1">{w.message}</span>
                <Link to={w.route} className="text-xs text-brand hover:underline whitespace-nowrap">
                  Ir
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-4">
        {sections.map((s) => (
          <section key={s.id} className="card p-5">
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-sm font-semibold">{s.label}</h2>
              <Chip estado={s.status} />
              <Link to={s.route} className="ml-auto btn-secondary text-sm">
                Abrir
              </Link>
            </div>

            {s.items ? (
              <>
                <p className="text-xs text-gray-500 mb-3">
                  {s.id === "schedules"
                    ? `${s.publishable} de ${s.total} publicados`
                    : `${s.complete} de ${s.total} cargados`}
                </p>
                <ListaItems items={s.items} seccion={s.id} ruta={s.route} />
              </>
            ) : s.confirmable ? (
              // Se resuelve con una confirmación escrita, y hay algo que
              // confirmar: el motivo lo explica el propio bloque.
              <ConfirmacionDato item={s.id} confirmation={s.confirmation ?? null} motivo={s.reason} />
            ) : (
              <p className="text-sm text-gray-600 mt-2">{s.reason}</p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
