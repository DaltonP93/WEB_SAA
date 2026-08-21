import { useMemo, useState, type ReactNode } from "react";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  /** Used for sort and search. If omitted, falls back to (row as any)[key]. */
  accessor?: (row: T) => string | number;
}

/**
 * Búsqueda, orden y paginación resueltos por el servidor.
 *
 * Es opcional a propósito: los CRUD que cargan la tabla entera —Médicos,
 * Especialidades, Servicios— siguen filtrando en el navegador sin cambio
 * alguno. Sólo lo usa la bandeja de Turnos, que crece sin techo y donde
 * recortar en el cliente significaba buscar dentro de las primeras 200 filas
 * y no dentro de las solicitudes.
 */
export interface DataTableServer {
  /** Texto de búsqueda. El componente lo dibuja; quién lo consulta es de afuera. */
  query: string;
  onQueryChange: (q: string) => void;
  /** Página actual, base 0. */
  page: number;
  onPageChange: (p: number) => void;
  /** Total de filas que coinciden con los filtros, no las recibidas. */
  total: number;
  sortKey: string | null;
  sortDir: "asc" | "desc";
  onSortChange: (key: string, dir: "asc" | "desc") => void;
}

interface Props<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string | number;
  searchPlaceholder?: string;
  /** Which column keys feed the search box. Defaults to all columns with an accessor. */
  searchKeys?: string[];
  /**
   * Los botones de la fila. El segundo argumento avisa cuándo la fila es de
   * una consulta que ya no vale: quien dibuje botones tiene que pasarles ese
   * `disabled`. El `fieldset` de abajo los desactiva igual —es la garantía en
   * el navegador—, pero pasarlo explícito es lo que hace que la desactivación
   * sea observable en una prueba y no dependa de cuánto del HTML implemente
   * jsdom.
   */
  actions?: (row: T, estado: { disabled: boolean }) => ReactNode;
  pageSize?: number;
  loading?: boolean;
  emptyMessage?: string;
  /** Cuando viene, el componente no filtra ni ordena ni pagina por su cuenta. */
  server?: DataTableServer;
  /**
   * Las filas visibles son de una consulta anterior y la actual todavía no
   * llegó: se muestran, pero no se pueden accionar.
   *
   * Con `placeholderData` la tabla no parpadea vacía al cambiar de página o de
   * filtro, y ese es el punto. El costo es que durante la transición se ven
   * filas que **no pertenecen al filtro nuevo**, y sus botones seguían
   * funcionando: quien confirmaba una solicitud creyendo que estaba mirando
   * "pendientes de hoy" podía estar confirmando la de otro día que todavía no
   * se había ido de la pantalla.
   */
  stale?: boolean;
}

function norm(v: unknown): string {
  return String(v ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function cellValue<T>(col: DataTableColumn<T>, row: T): string | number {
  if (col.accessor) return col.accessor(row);
  return (row as any)[col.key] ?? "";
}

export default function DataTable<T>({
  columns,
  rows,
  getRowId,
  searchPlaceholder = "Buscar…",
  searchKeys,
  actions,
  pageSize = 20,
  loading,
  emptyMessage = "No hay resultados.",
  server,
  stale = false,
}: Props<T>) {
  const [queryLocal, setQueryLocal] = useState("");
  const [sortKeyLocal, setSortKeyLocal] = useState<string | null>(null);
  const [sortDirLocal, setSortDirLocal] = useState<"asc" | "desc">("asc");
  const [pageLocal, setPageLocal] = useState(0);

  // En modo servidor el estado vive afuera: el componente sólo lo dibuja y
  // avisa. Tener dos copias —una acá y otra en la pantalla— haría que la
  // caja de búsqueda y la consulta se desincronizaran en cuanto una de las
  // dos se reiniciara sola.
  const query = server ? server.query : queryLocal;
  const setQuery = server ? server.onQueryChange : setQueryLocal;
  const sortKey = server ? server.sortKey : sortKeyLocal;
  const sortDir = server ? server.sortDir : sortDirLocal;
  const page = server ? server.page : pageLocal;
  const setPage = server ? server.onPageChange : setPageLocal;

  const searchCols = useMemo(
    () =>
      searchKeys
        ? columns.filter((c) => searchKeys.includes(c.key))
        : columns.filter((c) => c.accessor),
    [columns, searchKeys],
  );

  const filtered = useMemo(() => {
    // Con el servidor al mando, lo que llegó ya viene filtrado: volver a
    // recortarlo acá escondería filas que sí coinciden.
    if (server) return rows;
    const q = norm(query.trim());
    if (!q) return rows;
    return rows.filter((row) => searchCols.some((c) => norm(cellValue(c, row)).includes(q)));
  }, [rows, query, searchCols, server]);

  const sorted = useMemo(() => {
    if (server) return filtered;
    if (!sortKey) return filtered;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = cellValue(col, a);
      const bv = cellValue(col, b);
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = norm(av).localeCompare(norm(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir, columns, server]);

  // El total es el del servidor cuando lo hay: contar las filas recibidas
  // diría "20 de 20" con doscientas solicitudes esperando.
  const total = server ? server.total : sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * pageSize;
  const pageRows = server ? sorted : sorted.slice(start, start + pageSize);

  function toggleSort(col: DataTableColumn<T>) {
    if (!col.sortable) return;
    const proxima: "asc" | "desc" = sortKey === col.key && sortDir === "asc" ? "desc" : "asc";
    if (server) {
      server.onSortChange(col.key, proxima);
      return;
    }
    setSortKeyLocal(col.key);
    setSortDirLocal(proxima);
  }

  return (
    <div className="card overflow-hidden">
      <div className="p-3 border-b">
        <input
          className="input"
          placeholder={searchPlaceholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
      </div>

      <div className="overflow-x-auto">
        <table
          className={`w-full text-sm ${stale ? "opacity-60 transition-opacity" : ""}`}
          aria-busy={stale || !!loading}
        >
          <thead className="bg-gray-50 text-xs text-gray-500 border-b border-gray-200">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`text-left font-semibold uppercase tracking-wider text-[11px] px-4 py-2.5 ${c.sortable ? "cursor-pointer select-none" : ""}`}
                  onClick={() => toggleSort(c)}
                >
                  {c.header}
                  {c.sortable && sortKey === c.key && <span className="ml-1">{sortDir === "asc" ? "▲" : "▼"}</span>}
                </th>
              ))}
              {actions && <th className="px-4 py-2.5" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`sk-${i}`}>
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-3">
                      <div className="h-4 bg-gray-200 rounded animate-pulse" />
                    </td>
                  ))}
                  {actions && (
                    <td className="px-4 py-3">
                      <div className="h-4 bg-gray-200 rounded animate-pulse" />
                    </td>
                  )}
                </tr>
              ))
            ) : pageRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (actions ? 1 : 0)} className="px-4 py-10 text-center text-sm text-gray-500">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr key={getRowId(row)} className="odd:bg-gray-50/50 hover:bg-gray-100 transition-colors">
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-3 align-middle">
                      {c.render ? c.render(row) : String(cellValue(c, row) ?? "")}
                    </td>
                  ))}
                  {actions && (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {/* `fieldset[disabled]` desactiva de verdad todo control
                          que tenga adentro, sin que cada pantalla tenga que
                          acordarse de pasarle `disabled` a cada botón. */}
                      <fieldset disabled={stale} className="contents">
                        {actions(row, { disabled: stale })}
                      </fieldset>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && total > 0 && (
        <div className="flex items-center justify-between gap-3 p-3 border-t text-xs text-gray-500">
          <span>
            {start + 1}–{Math.min(start + pageSize, total)} de {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn-secondary text-xs disabled:opacity-40"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              Anterior
            </button>
            {Array.from({ length: pageCount }).map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setPage(i)}
                className={`px-2 py-1 rounded ${i === safePage ? "bg-brand text-white" : "hover:bg-gray-100"}`}
              >
                {i + 1}
              </button>
            ))}
            <button
              type="button"
              className="btn-secondary text-xs disabled:opacity-40"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
