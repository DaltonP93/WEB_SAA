import { useMemo, useState, type ReactNode } from "react";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  /** Used for sort and search. If omitted, falls back to (row as any)[key]. */
  accessor?: (row: T) => string | number;
}

interface Props<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string | number;
  searchPlaceholder?: string;
  /** Which column keys feed the search box. Defaults to all columns with an accessor. */
  searchKeys?: string[];
  actions?: (row: T) => ReactNode;
  pageSize?: number;
  loading?: boolean;
  emptyMessage?: string;
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
}: Props<T>) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);

  const searchCols = useMemo(
    () =>
      searchKeys
        ? columns.filter((c) => searchKeys.includes(c.key))
        : columns.filter((c) => c.accessor),
    [columns, searchKeys],
  );

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return rows;
    return rows.filter((row) => searchCols.some((c) => norm(cellValue(c, row)).includes(q)));
  }, [rows, query, searchCols]);

  const sorted = useMemo(() => {
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
  }, [filtered, sortKey, sortDir, columns]);

  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * pageSize;
  const pageRows = sorted.slice(start, start + pageSize);

  function toggleSort(col: DataTableColumn<T>) {
    if (!col.sortable) return;
    if (sortKey === col.key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col.key);
      setSortDir("asc");
    }
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
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`text-left font-medium px-4 py-2 ${c.sortable ? "cursor-pointer select-none" : ""}`}
                  onClick={() => toggleSort(c)}
                >
                  {c.header}
                  {c.sortable && sortKey === c.key && <span className="ml-1">{sortDir === "asc" ? "▲" : "▼"}</span>}
                </th>
              ))}
              {actions && <th className="px-4 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y">
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
                <tr key={getRowId(row)} className="hover:bg-gray-50">
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-3 align-middle">
                      {c.render ? c.render(row) : String(cellValue(c, row) ?? "")}
                    </td>
                  ))}
                  {actions && <td className="px-4 py-3 text-right whitespace-nowrap">{actions(row)}</td>}
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
