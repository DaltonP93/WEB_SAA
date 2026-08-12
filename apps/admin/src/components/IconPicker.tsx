import { useMemo, useState } from "react";
import dynamicIconImports from "lucide-react/dynamicIconImports";
import LucideIcon, { isIconName } from "./LucideIcon";

/**
 * Selector de iconos lucide.
 *
 * Antes el campo era texto libre: un nombre mal escrito no rompía nada
 * visible, el componente simplemente no dibujaba y el hueco aparecía recién
 * en el sitio publicado. Acá sólo se puede elegir un nombre que existe, y los
 * que ya usa otra fila de la misma grilla se marcan como ocupados (la API los
 * rechaza con 409, así que conviene verlo antes de guardar).
 */

const ALL_NAMES = Object.keys(dynamicIconImports as Record<string, unknown>).sort();

interface Props {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  /** Iconos ya usados por otras filas de la misma grilla. */
  taken?: string[];
  placeholder?: string;
}

export default function IconPicker({ value, onChange, taken = [], placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const takenSet = useMemo(() => new Set(taken.filter((t) => t && t !== value)), [taken, value]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? ALL_NAMES.filter((n) => n.includes(q)) : ALL_NAMES;
    // Los libres primero: son los que efectivamente se pueden guardar.
    const free = base.filter((n) => !takenSet.has(n));
    const used = base.filter((n) => takenSet.has(n));
    return [...free, ...used].slice(0, 120);
  }, [query, takenSet]);

  const current = typeof value === "string" ? value : "";
  const invalid = current !== "" && !isIconName(current);

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="w-9 h-9 flex items-center justify-center flex-shrink-0 border rounded bg-gray-50 text-primary">
          {current && isIconName(current) ? (
            <LucideIcon name={current} className="w-5 h-5 text-primary" />
          ) : (
            <span className="text-gray-300 text-xs">?</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="input text-left flex-1"
          aria-expanded={open}
        >
          {current || <span className="text-gray-400">{placeholder ?? "Elegir icono…"}</span>}
        </button>
        {current && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs text-gray-500 hover:text-gray-700 px-2"
          >
            Quitar
          </button>
        )}
      </div>

      {invalid && (
        <p className="mt-1 text-xs font-medium text-red-700">
          «{current}» no existe en lucide: elegí uno de la lista.
        </p>
      )}

      {open && (
        <div className="mt-2 border rounded bg-white shadow-sm">
          <input
            autoFocus
            className="input rounded-b-none border-0 border-b"
            placeholder={`Buscar entre ${ALL_NAMES.length} iconos…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="max-h-64 overflow-y-auto p-2 grid grid-cols-6 sm:grid-cols-8 gap-1">
            {results.map((name) => {
              const used = takenSet.has(name);
              return (
                <button
                  key={name}
                  type="button"
                  disabled={used}
                  title={used ? `${name} — ya lo usa otra fila` : name}
                  onClick={() => {
                    onChange(name);
                    setOpen(false);
                  }}
                  className={`aspect-square flex items-center justify-center rounded border text-primary ${
                    name === current ? "border-primary bg-primary/5" : "border-transparent"
                  } ${used ? "opacity-25 cursor-not-allowed" : "hover:bg-gray-100"}`}
                >
                  <LucideIcon name={name} className="w-5 h-5" />
                </button>
              );
            })}
            {results.length === 0 && (
              <p className="col-span-full text-sm text-gray-500 p-2">Ningún icono coincide.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
