import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import toast from "react-hot-toast";
import { api } from "../api";
import { useConfirm } from "./ConfirmDialog";
import LucideIcon, { isIconName } from "./LucideIcon";

/** Muestra el icono: lucide si es un nombre conocido, si no el texto/emoji tal cual. */
function IconBadge({ value, className = "w-5 h-5 text-gray-500" }: { value: string; className?: string }) {
  if (isIconName(value)) return <LucideIcon name={value} className={className} />;
  return <span className="text-xl leading-none">{value}</span>;
}

export interface FieldDef {
  key: string;
  label: string;
  kind?: "text" | "textarea" | "icon" | "select";
  options?: { value: string; label: string }[];
}

interface Props {
  title: string;
  endpoint: string;
  cacheKey: string;
  fields: FieldDef[];
  slugFrom?: string;
  reorderable?: boolean;
}

function slugify(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function norm(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function EntityRow({ row, reorderable, onEdit, onDelete }: { row: any; reorderable: boolean; onEdit: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id, disabled: !reorderable });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="p-4 flex items-center gap-3 bg-white">
      {reorderable && (
        <button {...attributes} {...listeners} className="cursor-grab text-gray-400 text-lg flex-shrink-0" title="arrastrar">⋮⋮</button>
      )}
      {row.icon ? <span className="w-7 flex items-center justify-center flex-shrink-0 text-primary"><IconBadge value={row.icon} className="w-5 h-5 text-primary" /></span> : null}
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate flex items-center gap-2">
          {row.name}
          {row.category && <span className="text-[10px] uppercase tracking-wide bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">{row.category}</span>}
        </div>
        <div className="text-xs text-gray-500 truncate">/{row.slug}{row.description ? ` · ${String(row.description).slice(0, 80)}` : ""}</div>
      </div>
      <button onClick={onEdit} className="btn-secondary">Editar</button>
      <button onClick={onDelete} className="btn-danger">Eliminar</button>
    </div>
  );
}

export default function EntityManager({ title, endpoint, cacheKey, fields, slugFrom = "name", reorderable = false }: Props) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const list = useQuery({ queryKey: [cacheKey], queryFn: async () => (await api.get(endpoint)).data });
  const [editing, setEditing] = useState<any | null>(null);
  const [query, setQuery] = useState("");

  const save = useMutation({
    mutationFn: async (payload: any) => {
      const body = { ...payload, slug: payload.slug || slugify(payload[slugFrom] ?? "") };
      if (payload.id) return (await api.put(`${endpoint}/${payload.id}`, body)).data;
      return (await api.post(endpoint, body)).data;
    },
    onSuccess: () => { toast.success("Guardado"); setEditing(null); qc.invalidateQueries({ queryKey: [cacheKey] }); },
    onError: () => toast.error("Error"),
  });

  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`${endpoint}/${id}`),
    onSuccess: () => { toast.success("Eliminado"); qc.invalidateQueries({ queryKey: [cacheKey] }); },
    onError: () => toast.error("Error al eliminar"),
  });

  // Persist reorder: PUT { order: newIndex } for each row whose index changed.
  const reorder = useMutation({
    mutationFn: async (ordered: any[]) => {
      const changed = ordered
        .map((row, idx) => ({ row, idx }))
        .filter(({ row, idx }) => row.order !== idx);
      await Promise.all(changed.map(({ row, idx }) => api.put(`${endpoint}/${row.id}`, { order: idx })));
    },
    onSuccess: () => { toast.success("Orden actualizado"); qc.invalidateQueries({ queryKey: [cacheKey] }); },
    onError: () => { toast.error("Error al reordenar"); qc.invalidateQueries({ queryKey: [cacheKey] }); },
  });

  const rows: any[] = list.data ?? [];

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return rows;
    return rows.filter((r) =>
      norm(String(r.name ?? "")).includes(q) ||
      norm(String(r.slug ?? "")).includes(q) ||
      norm(String(r.description ?? "")).includes(q),
    );
  }, [rows, query]);

  // Drag only when reorderable AND not filtering (reorder + filtered view conflict).
  const canDrag = reorderable && query.trim() === "";

  async function askDelete(row: any) {
    if (await confirm({ title: "Eliminar", message: `¿Eliminar "${row.name}"? Esta acción no se puede deshacer.`, confirmLabel: "Eliminar", danger: true })) {
      del.mutate(row.id);
    }
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIdx = rows.findIndex((r) => r.id === e.active.id);
    const newIdx = rows.findIndex((r) => r.id === e.over!.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(rows, oldIdx, newIdx);
    qc.setQueryData([cacheKey], next); // optimistic for snappy UX
    reorder.mutate(next);
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{title}</h1>
        <button onClick={() => setEditing({})} className="btn-primary">+ Nuevo</button>
      </div>

      {editing && (
        <div className="card p-4 mb-4">
          <h2 className="font-semibold mb-3">{editing.id ? "Editar" : "Nuevo"}</h2>
          <div className="grid md:grid-cols-2 gap-3">
            {fields.map((f) => (
              <div key={f.key} className={f.kind === "textarea" ? "md:col-span-2" : ""}>
                <label className="label">{f.label}</label>
                {f.kind === "textarea" ? (
                  <textarea className="input" rows={3} value={editing[f.key] ?? ""} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })} />
                ) : f.kind === "select" ? (
                  <select className="input" value={editing[f.key] ?? ""} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value || null })}>
                    <option value="">—</option>
                    {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : f.kind === "icon" ? (
                  <div className="flex items-center gap-2">
                    <span className="w-9 h-9 flex items-center justify-center flex-shrink-0 border rounded bg-gray-50 text-primary">
                      {editing[f.key] ? <IconBadge value={editing[f.key]} className="w-5 h-5 text-primary" /> : <span className="text-gray-300 text-xs">?</span>}
                    </span>
                    <input className="input" value={editing[f.key] ?? ""} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })} placeholder="nombre lucide (ej: heart-pulse) o emoji" />
                  </div>
                ) : (
                  <input className="input" value={editing[f.key] ?? ""} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })} />
                )}
              </div>
            ))}
            <div>
              <label className="label">Slug</label>
              <input className="input" value={editing.slug ?? ""} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} placeholder={slugify(editing[slugFrom] ?? "")} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setEditing(null)} className="btn-secondary">Cancelar</button>
            <button onClick={() => save.mutate(editing)} className="btn-primary">Guardar</button>
          </div>
        </div>
      )}

      <input className="input mb-4" placeholder="Buscar por nombre, slug o descripción…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {reorderable && query.trim() !== "" && (
        <p className="text-xs text-gray-400 mb-2">Limpiá la búsqueda para reordenar.</p>
      )}

      {list.isLoading ? (
        <div className="card divide-y">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="p-4"><div className="h-5 bg-gray-200 rounded animate-pulse" /></div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center text-sm text-gray-500">No hay resultados.</div>
      ) : (
        <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={filtered.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            <div className="card divide-y overflow-hidden">
              {filtered.map((row) => (
                <EntityRow
                  key={row.id}
                  row={row}
                  reorderable={canDrag}
                  onEdit={() => setEditing(row)}
                  onDelete={() => askDelete(row)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
