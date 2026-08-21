import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../api";
import DataTable, { type DataTableColumn } from "../components/DataTable";
import { useConfirm } from "../components/ConfirmDialog";
import { formatearEnZona } from "../lib/fecha";

/**
 * Bandeja de solicitudes de turno.
 *
 * El turno se coordina por WhatsApp; acá no se responde nada. Lo que esta
 * pantalla resuelve es que la solicitud exista para el sanatorio aunque el
 * paciente no llegue a escribir, escriba desde otro número o su mensaje se
 * pierda entre cientos.
 *
 * ## Todo lo que recorta la lista lo hace el servidor
 *
 * La versión anterior pedía las primeras 200 filas y buscaba, ordenaba y
 * paginaba sobre eso. Con más de 200 solicitudes, buscar un apellido que
 * estuviera más abajo devolvía "sin resultados", el contador decía cuántas
 * había recibido en vez de cuántas hay, y las páginas que faltaban
 * sencillamente no existían. Ahora la búsqueda, el orden y la ventana viajan a
 * la base, y la exportación pide su propio archivo completo.
 *
 * Los datos personales que se ven acá **sólo se ven acá**: el endpoint público
 * nunca los devuelve y esta pantalla cuelga de `requireAuth`.
 */

type Estado = "pendiente" | "confirmado" | "cancelado";

interface Turno {
  id: number;
  name: string;
  phone: string;
  email: string;
  preferred_at: string | null;
  message: string | null;
  status: Estado;
  consent_at: string | null;
  created_at: string;
  updated_at: string | null;
  doctor_name: string | null;
  specialty_name: string | null;
}

interface Pagina {
  items: Turno[];
  total: number;
  limit: number;
  offset: number;
}

export const APPOINTMENTS_KEY = "adm-appointments";
const POR_PAGINA = 20;
/** Lo que se espera a que la persona deje de tipear antes de consultar. */
export const DEBOUNCE_MS = 300;

const ESTADOS: { value: Estado; label: string; clase: string }[] = [
  { value: "pendiente", label: "Pendiente", clase: "bg-amber-100 text-amber-900 border-amber-200" },
  { value: "confirmado", label: "Confirmado", clase: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  { value: "cancelado", label: "Cancelado", clase: "bg-gray-100 text-gray-600 border-gray-200" },
];

const etiqueta = (estado: string) => ESTADOS.find((e) => e.value === estado) ?? ESTADOS[0];

const fecha = (valor: string | null) => formatearEnZona(valor) || "—";

/** Los filtros que entiende la API, en un solo lugar. */
function comoQuery(f: {
  status: string;
  from: string;
  to: string;
  q: string;
  sort: string | null;
  dir: "asc" | "desc";
  page: number;
}): string {
  const params = new URLSearchParams();
  if (f.status) params.set("status", f.status);
  if (f.from) params.set("from", f.from);
  if (f.to) params.set("to", f.to);
  if (f.q) params.set("q", f.q);
  if (f.sort) {
    params.set("sort", f.sort);
    params.set("dir", f.dir);
  }
  params.set("limit", String(POR_PAGINA));
  params.set("offset", String(f.page * POR_PAGINA));
  return params.toString();
}

export default function AppointmentsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();

  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  /** Lo que se está tipeando. */
  const [busqueda, setBusqueda] = useState("");
  /** Lo que ya se consultó: se actualiza cuando la persona deja de tipear. */
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<string | null>(null);
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);

  useEffect(() => {
    // Sin esto cada tecla dispara una consulta, y las respuestas pueden llegar
    // desordenadas: la de "Bru" después de la de "Bruno".
    const t = setTimeout(() => setQ(busqueda.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [busqueda]);

  // Cambiar qué se busca invalida en qué página estabas: la página 7 de otro
  // conjunto no existe, y quedarse ahí muestra una tabla vacía sobre un total
  // que dice que hay resultados.
  useEffect(() => setPage(0), [q, status, from, to, sort, dir]);

  const filtros = { status, from, to, q, sort, dir, page };
  const list = useQuery({
    queryKey: [APPOINTMENTS_KEY, filtros],
    queryFn: async () => (await api.get(`/admin/appointments?${comoQuery(filtros)}`)).data as Pagina,
    // Sin esto, al pasar de página la tabla parpadea vacía entre respuestas.
    placeholderData: (previa) => previa,
  });

  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? 0;

  /**
   * Las filas de la pantalla son de la consulta anterior.
   *
   * `placeholderData` evita el parpadeo en blanco al cambiar de página, pero
   * deja a la vista filas que ya no pertenecen a lo que se está pidiendo. Con
   * los botones activos, confirmar "la primera de la lista" durante ese
   * instante actúa sobre la solicitud vieja, no sobre la que se ve un segundo
   * después. Mientras dure la transición la tabla se marca ocupada y las
   * acciones quedan desactivadas.
   */
  const enTransicion = list.isFetching || list.isPlaceholderData;

  /**
   * Volver a la última página que todavía existe.
   *
   * Al eliminar la única solicitud de la última página, ese `offset` deja de
   * tener filas: la API responde correctamente con `items: []` y el total ya
   * corregido, y el panel se quedaba mostrando una tabla vacía sobre un
   * contador que decía que había resultados. Sin recargar a mano no se salía.
   *
   * Se calcula sobre el `total` del servidor —no sobre las filas recibidas—
   * así que también cubre que otra persona borre desde otra sesión.
   */
  useEffect(() => {
    // Sólo con la respuesta de esta consulta: el total que sobrevive de la
    // anterior mandaría a una página que tampoco existe.
    if (list.isPlaceholderData || page === 0) return;
    // `Math.max(0, …)` cubre que se hayan borrado todas: con `total = 0` la
    // cuenta da −1, y una página negativa pide un `offset` inválido.
    const ultima = Math.max(0, Math.ceil(total / POR_PAGINA) - 1);
    if (page > ultima) setPage(ultima);
  }, [total, page, list.isPlaceholderData]);

  const invalidar = () => qc.invalidateQueries({ queryKey: [APPOINTMENTS_KEY] });

  const cambiar = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: Estado }) =>
      api.put(`/admin/appointments/${id}`, { status }),
    onSuccess: () => {
      toast.success("Estado actualizado");
      invalidar();
    },
    onError: () => toast.error("No se pudo actualizar el estado"),
  });

  const borrar = useMutation({
    mutationFn: async (id: number) => api.delete(`/admin/appointments/${id}`),
    onSuccess: () => {
      toast.success("Solicitud eliminada");
      invalidar();
    },
    onError: () => toast.error("No se pudo eliminar la solicitud"),
  });

  async function eliminar(t: Turno) {
    const ok = await confirm({
      title: "Eliminar solicitud",
      message: `¿Eliminar la solicitud de ${t.name}? No se puede deshacer.`,
      confirmLabel: "Eliminar",
      danger: true,
    });
    if (ok) borrar.mutate(t.id);
  }

  const [exportando, setExportando] = useState(false);

  /**
   * Descarga **todo** lo que coincide con los filtros, no la página visible.
   *
   * El archivo lo arma la API: es la única que tiene el resultado entero sin
   * recorrer páginas, y así sale con `Cache-Control: no-store` y con las
   * celdas neutralizadas para que una planilla no ejecute lo que alguien
   * escribió en el formulario público.
   */
  async function exportar() {
    setExportando(true);
    try {
      const sinPagina = comoQuery({ status, from, to, q, sort, dir, page: 0 })
        .split("&")
        .filter((p) => !p.startsWith("limit=") && !p.startsWith("offset="))
        .join("&");
      const res = await api.get(`/admin/appointments/export${sinPagina ? `?${sinPagina}` : ""}`, {
        responseType: "text",
        transformResponse: [(d) => d],
      });
      const blob = new Blob([res.data as string], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "turnos.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error("No se pudo exportar");
    } finally {
      setExportando(false);
    }
  }

  const columnas: DataTableColumn<Turno>[] = [
    {
      key: "created_at",
      header: "Solicitado",
      sortable: true,
      accessor: (t) => t.created_at ?? "",
      render: (t) => <span className="whitespace-nowrap">{fecha(t.created_at)}</span>,
    },
    {
      key: "name",
      header: "Paciente",
      sortable: true,
      accessor: (t) => t.name,
      render: (t) => (
        <div>
          <div className="font-medium">{t.name}</div>
          <div className="text-xs text-gray-500">
            {t.phone}
            {t.email ? ` · ${t.email}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "specialty_name",
      header: "Especialidad / médico",
      sortable: true,
      accessor: (t) => `${t.specialty_name ?? ""} ${t.doctor_name ?? ""}`.trim(),
      render: (t) => (
        <div className="text-xs">
          <div>{t.specialty_name ?? "—"}</div>
          {t.doctor_name && <div className="text-gray-500">{t.doctor_name}</div>}
        </div>
      ),
    },
    {
      key: "preferred_at",
      header: "Preferencia",
      sortable: true,
      accessor: (t) => t.preferred_at ?? "",
      render: (t) => <span className="text-xs whitespace-nowrap">{fecha(t.preferred_at)}</span>,
    },
    {
      key: "status",
      header: "Estado",
      sortable: true,
      accessor: (t) => t.status,
      render: (t) => {
        const e = etiqueta(t.status);
        return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${e.clase}`}>{e.label}</span>;
      },
    },
    {
      key: "message",
      header: "Mensaje",
      accessor: (t) => t.message ?? "",
      render: (t) => <span className="text-xs text-gray-600">{t.message ?? "—"}</span>,
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Turnos</h1>
      <p className="text-sm text-gray-500 mb-6">
        Solicitudes recibidas desde el sitio. La coordinación sigue siendo por WhatsApp; acá queda el
        registro para que ninguna se pierda. Los horarios están en hora de Asunción.
      </p>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="label" htmlFor="f-estado">Estado</label>
          <select id="f-estado" value={status} onChange={(e) => setStatus(e.target.value)} className="input">
            <option value="">Todos</option>
            {ESTADOS.map((e) => (
              <option key={e.value} value={e.value}>{e.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-desde">Desde</label>
          <input id="f-desde" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="f-hasta">Hasta</label>
          <input id="f-hasta" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input" />
        </div>
        <button onClick={exportar} className="btn-secondary" disabled={total === 0 || exportando}>
          {exportando ? "Exportando…" : "Exportar CSV"}
        </button>
        <span className="text-sm text-gray-500 ml-auto">
          {/* El total es el del servidor: contar `rows` diría cuántas se
              recibieron en esta página, no cuántas coinciden. */}
          {total} {total === 1 ? "solicitud" : "solicitudes"}
        </span>
      </div>

      {list.isError ? (
        <div className="card p-5 border-red-200 bg-red-50">
          <p className="text-sm text-red-800 font-medium">No se pudieron cargar las solicitudes.</p>
          <button onClick={() => list.refetch()} className="btn-secondary mt-3">Reintentar</button>
        </div>
      ) : (
        <DataTable
          columns={columnas}
          rows={rows}
          getRowId={(t) => t.id}
          pageSize={POR_PAGINA}
          loading={list.isLoading}
          stale={enTransicion}
          searchPlaceholder="Buscar por nombre, teléfono, email, médico o especialidad…"
          emptyMessage="No hay solicitudes de turno con esos filtros."
          server={{
            query: busqueda,
            onQueryChange: setBusqueda,
            page,
            onPageChange: setPage,
            total,
            sortKey: sort,
            sortDir: dir,
            onSortChange: (key, direccion) => {
              setSort(key);
              setDir(direccion);
            },
          }}
          actions={(t, { disabled }) => (
            <div className="flex items-center justify-end gap-2">
              {t.status !== "confirmado" && (
                <button
                  onClick={() => cambiar.mutate({ id: t.id, status: "confirmado" })}
                  disabled={disabled}
                  className="text-emerald-700 text-xs disabled:text-gray-400 disabled:cursor-not-allowed"
                >
                  Confirmar
                </button>
              )}
              {t.status !== "cancelado" && (
                <button
                  onClick={() => cambiar.mutate({ id: t.id, status: "cancelado" })}
                  disabled={disabled}
                  className="text-amber-700 text-xs disabled:text-gray-400 disabled:cursor-not-allowed"
                >
                  Cancelar
                </button>
              )}
              {t.status !== "pendiente" && (
                <button
                  onClick={() => cambiar.mutate({ id: t.id, status: "pendiente" })}
                  disabled={disabled}
                  className="text-brand text-xs disabled:text-gray-400 disabled:cursor-not-allowed"
                >
                  Volver a pendiente
                </button>
              )}
              <button
                onClick={() => eliminar(t)}
                disabled={disabled}
                className="text-red-600 text-xs disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                Eliminar
              </button>
            </div>
          )}
        />
      )}
    </div>
  );
}
