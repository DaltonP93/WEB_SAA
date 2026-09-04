import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../api";
import DataTable, { type DataTableColumn } from "../components/DataTable";
import { formatearEnZona } from "../lib/fecha";
import { useSesion } from "../hooks/useSesion";

/**
 * Bitácora de acciones administrativas (solo lectura, solo superadmin).
 *
 * Muestra quién hizo qué y cuándo: crear/editar/borrar contenido, publicar,
 * programar, mandar a la papelera, restaurar, purgar, cambiar roles y los
 * accesos (ok/fallido). La tabla es append-only en el servidor; acá no se edita
 * nada. Búsqueda, filtros, orden y paginación los resuelve la API.
 *
 * El acceso lo protege el backend (`requireRole("superadmin")`); ocultar el
 * enlace del sidebar es sólo UX. Igual se gatea la pantalla para no mostrarle a
 * un editor una tabla que la API le va a negar.
 */

interface AuditRow {
  id: number;
  actor_id: number | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  meta: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
}

interface Pagina {
  items: AuditRow[];
  total: number;
  limit: number;
  offset: number;
}

const AUDIT_KEY = "adm-audit";
const POR_PAGINA = 25;
const DEBOUNCE_MS = 300;

/** Acciones conocidas, con una etiqueta legible. */
const ACCIONES: { value: string; label: string }[] = [
  { value: "create", label: "Crear" },
  { value: "update", label: "Editar" },
  { value: "delete", label: "Eliminar" },
  { value: "publish", label: "Publicar" },
  { value: "unpublish", label: "Despublicar" },
  { value: "schedule", label: "Programar" },
  { value: "trash", label: "A papelera" },
  { value: "restore", label: "Restaurar" },
  { value: "purge", label: "Borrado definitivo" },
  { value: "restore_revision", label: "Restaurar versión" },
  { value: "role_change", label: "Cambio de rol" },
  { value: "login_ok", label: "Acceso" },
  { value: "login_fail", label: "Acceso fallido" },
];

const etiquetaAccion = (a: string) => ACCIONES.find((x) => x.value === a)?.label ?? a;

const fecha = (valor: string | null) => formatearEnZona(valor) || "—";

function comoQuery(f: {
  action: string;
  resource_type: string;
  from: string;
  to: string;
  q: string;
  sort: string | null;
  dir: "asc" | "desc";
  page: number;
}): string {
  const params = new URLSearchParams();
  if (f.action) params.set("action", f.action);
  if (f.resource_type) params.set("resource_type", f.resource_type);
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

export default function AuditPage() {
  const { esSuperadmin, cargando } = useSesion();

  const [action, setAction] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<string | null>(null);
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setQ(busqueda.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [busqueda]);

  useEffect(() => setPage(0), [q, action, resourceType, from, to, sort, dir]);

  const filtros = { action, resource_type: resourceType, from, to, q, sort, dir, page };
  const list = useQuery({
    queryKey: [AUDIT_KEY, filtros],
    queryFn: async () => (await api.get(`/admin/audit?${comoQuery(filtros)}`)).data as Pagina,
    placeholderData: (previa) => previa,
    enabled: esSuperadmin,
  });

  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? 0;
  const enTransicion = list.isFetching || list.isPlaceholderData;

  useEffect(() => {
    if (list.isPlaceholderData || page === 0) return;
    const ultima = Math.max(0, Math.ceil(total / POR_PAGINA) - 1);
    if (page > ultima) setPage(ultima);
  }, [total, page, list.isPlaceholderData]);

  const [exportando, setExportando] = useState(false);
  async function exportar() {
    setExportando(true);
    try {
      const sinPagina = comoQuery({ action, resource_type: resourceType, from, to, q, sort, dir, page: 0 })
        .split("&")
        .filter((p) => !p.startsWith("limit=") && !p.startsWith("offset="))
        .join("&");
      const res = await api.get(`/admin/audit/export${sinPagina ? `?${sinPagina}` : ""}`, {
        responseType: "text",
        transformResponse: [(d) => d],
      });
      const blob = new Blob([res.data as string], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "auditoria.csv";
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

  const columnas: DataTableColumn<AuditRow>[] = [
    {
      key: "created_at",
      header: "Cuándo",
      sortable: true,
      accessor: (r) => r.created_at ?? "",
      render: (r) => <span className="whitespace-nowrap text-xs">{fecha(r.created_at)}</span>,
    },
    {
      key: "actor_name",
      header: "Quién",
      sortable: true,
      accessor: (r) => r.actor_name ?? "",
      render: (r) => (
        <div>
          <div className="font-medium">{r.actor_name ?? "—"}</div>
          <div className="text-xs text-gray-500">
            {r.actor_role ?? "sin sesión"}
            {r.ip ? ` · ${r.ip}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "action",
      header: "Acción",
      sortable: true,
      accessor: (r) => r.action,
      render: (r) => (
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-gray-100 text-gray-700 border-gray-200">
          {etiquetaAccion(r.action)}
        </span>
      ),
    },
    {
      key: "resource_type",
      header: "Recurso",
      sortable: true,
      accessor: (r) => `${r.resource_type ?? ""} ${r.resource_id ?? ""}`.trim(),
      render: (r) =>
        r.resource_type ? (
          <span className="text-xs">
            {r.resource_type}
            {r.resource_id ? <span className="text-gray-500"> #{r.resource_id}</span> : null}
          </span>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        ),
    },
    {
      key: "meta",
      header: "Detalle",
      accessor: (r) => (r.meta ? JSON.stringify(r.meta) : ""),
      render: (r) =>
        r.meta && Object.keys(r.meta).length > 0 ? (
          <span className="text-xs text-gray-600 break-all">
            {Object.entries(r.meta)
              .map(([k, v]) => `${k}: ${String(v)}`)
              .join(" · ")}
          </span>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        ),
    },
  ];

  if (!cargando && !esSuperadmin) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-1">Auditoría</h1>
        <p className="text-sm text-gray-500">Sólo un superadministrador puede ver la bitácora de acciones.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Auditoría</h1>
      <p className="text-sm text-gray-500 mb-6">
        Registro de acciones administrativas: quién creó, editó, publicó, borró o restauró contenido, cambios de rol y
        accesos. Sólo lectura. Los horarios están en hora de Asunción.
      </p>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="label" htmlFor="f-accion">Acción</label>
          <select id="f-accion" value={action} onChange={(e) => setAction(e.target.value)} className="input">
            <option value="">Todas</option>
            {ACCIONES.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-recurso">Recurso</label>
          <input
            id="f-recurso"
            type="text"
            value={resourceType}
            onChange={(e) => setResourceType(e.target.value)}
            placeholder="pages, users, doctors…"
            className="input"
          />
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
          {total} {total === 1 ? "registro" : "registros"}
        </span>
      </div>

      {list.isError ? (
        <div className="card p-5 border-red-200 bg-red-50">
          <p className="text-sm text-red-800 font-medium">No se pudo cargar la bitácora.</p>
          <button onClick={() => list.refetch()} className="btn-secondary mt-3">Reintentar</button>
        </div>
      ) : (
        <DataTable
          columns={columnas}
          rows={rows}
          getRowId={(r) => r.id}
          pageSize={POR_PAGINA}
          loading={list.isLoading}
          stale={enTransicion}
          searchPlaceholder="Buscar por autor, id de recurso o acción…"
          emptyMessage="No hay acciones registradas con esos filtros."
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
        />
      )}
    </div>
  );
}
